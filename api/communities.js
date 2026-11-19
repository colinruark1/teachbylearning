// Community posts that every signed-in member can see. vercel.json rewrites
// /api/communities/<path> to /api/communities?__path=<path>.
//
//   GET    /api/communities/posts               recent posts (all communities), with likes and comments
//   POST   /api/communities/share               { checkinId, body } → posts one of your check-ins to
//                                               the community its commitment shares to (once per check-in)
//   DELETE /api/communities/posts/:id           delete your own post (the check-in stays)
//   POST   /api/communities/posts/:id/like      toggle your like → { likes, liked }
//   POST   /api/communities/posts/:id/comments  { body } → the new comment
//   GET    /api/communities/posts/:id/photo     the post's photo (the check-in's proof photo)
import { HttpError, bad, json, str, requireUser, readBody, handler, fileResponse } from "../lib/http.js";
import { pool } from "../lib/db.js";
import { storage } from "../lib/storage/index.js";
import { shareTarget } from "../lib/communities.js";

const LIMIT = 300;

// A stable avatar color per account, so other members don't see account ids.
const hueFor = (id) => [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

const postId = (raw) => {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, "Not found.");
  return id;
};

/* ---------- Reading ---------- */

// Posts in the shape communities.js renders. `onlyId` fetches a single post.
async function listPosts(user, onlyId = null) {
  const { rows: posts } = await pool.query(
    `select p.id, p.skill, p.sub, p.kind, p.body, p.minutes, p.user_id, u.name,
            (extract(epoch from p.created_at) * 1000)::float8 as t,
            coalesce(c.proof_type = 'photo', false) as photo,
            case when c.proof_type = 'photo' then nullif(c.proof_transcript, '') end as transcript,
            (select count(*) from community_like l where l.post_id = p.id)::int as likes,
            exists (select 1 from community_like l where l.post_id = p.id and l.user_id = $1) as liked
     from community_post p
     join "user" u on u.id = p.user_id
     left join habit_checkin c on c.id = p.checkin_id
     where ($2::bigint is null or p.id = $2)
     order by p.created_at desc
     limit ${LIMIT}`, [user.id, onlyId]);
  if (!posts.length) return [];

  const { rows: comments } = await pool.query(
    `select cm.id, cm.post_id, cm.user_id, cm.body, u.name,
            (extract(epoch from cm.created_at) * 1000)::float8 as t
     from community_comment cm join "user" u on u.id = cm.user_id
     where cm.post_id = any($1) order by cm.created_at`, [posts.map((p) => p.id)]);
  const byPost = {};
  for (const c of comments) {
    (byPost[c.post_id] ??= []).push({
      id: c.id, user: c.name || "Member", hue: hueFor(c.user_id), body: c.body, t: c.t, mine: c.user_id === user.id,
    });
  }

  return posts.map((p) => ({
    id: p.id, kind: p.kind, skill: p.skill, sub: p.sub, body: p.body, minutes: p.minutes,
    photo: p.photo, transcript: p.transcript, user: p.name || "Member", hue: hueFor(p.user_id), mine: p.user_id === user.id, t: p.t,
    likes: p.likes, liked: p.liked, comments: byPost[p.id] || [],
  }));
}

async function onePost(user, id) {
  const [p] = await listPosts(user, id);
  if (!p) throw new HttpError(404, "Not found.");
  return p;
}

/* ---------- Writing ---------- */

async function shareCheckin(user, body) {
  const checkinId = postId(body?.checkinId);
  const { rows } = await pool.query(
    `select c.habit, c.details, m.community
     from habit_checkin c
     left join habit_commitment m on m.user_id = c.user_id and m.habit = c.habit
     where c.id = $1 and c.user_id = $2`, [checkinId, user.id]);
  const r = rows[0];
  if (!r) throw new HttpError(404, "That check-in doesn't exist.");
  const target = shareTarget(r.habit, r.community);
  if (!target) bad("This habit isn't shared to a community. Pick one under Edit commitments.");

  const text = str(body?.body, 4000);
  const m = Number(r.details?.minutes);
  const minutes = Number.isFinite(m) && m >= 1 ? Math.min(Math.round(m), 1440) : null;
  // One post per check-in: sharing again (e.g. a retry) returns the existing post.
  await pool.query(
    `insert into community_post (user_id, skill, sub, body, minutes, checkin_id)
     values ($1, $2, $3, $4, $5, $6) on conflict (checkin_id) do nothing`,
    [user.id, target.skill, target.sub, text, minutes, checkinId]);
  const { rows: [post] } = await pool.query("select id from community_post where checkin_id = $1", [checkinId]);
  return onePost(user, post.id);
}

async function deletePost(user, id) {
  const { rowCount } = await pool.query("delete from community_post where id = $1 and user_id = $2", [id, user.id]);
  if (!rowCount) throw new HttpError(404, "Not found.");
  return { ok: true };
}

async function toggleLike(user, id) {
  const { rowCount } = await pool.query("delete from community_like where post_id = $1 and user_id = $2", [id, user.id]);
  if (!rowCount) {
    const { rowCount: added } = await pool.query(
      `insert into community_like (post_id, user_id) select id, $2 from community_post where id = $1
       on conflict do nothing`, [id, user.id]);
    if (!added) throw new HttpError(404, "Not found.");
  }
  const { rows: [r] } = await pool.query(
    "select count(*)::int as likes from community_like where post_id = $1", [id]);
  return { likes: r.likes, liked: !rowCount };
}

async function addComment(user, id, body) {
  const text = str(body?.body, 1000);
  if (!text) bad("Write a comment first.");
  const { rows } = await pool.query(
    `insert into community_comment (post_id, user_id, body) select id, $2, $3 from community_post where id = $1
     returning id, (extract(epoch from created_at) * 1000)::float8 as t`, [id, user.id, text]);
  if (!rows[0]) throw new HttpError(404, "Not found.");
  return { id: rows[0].id, user: user.name || "Member", hue: hueFor(user.id), body: text, t: rows[0].t, mine: true };
}

// A shared post's photo is its check-in's proof photo, visible to any signed-in member.
async function postPhoto(id) {
  const { rows } = await pool.query(
    `select c.proof, c.proof_storage from community_post p
     join habit_checkin c on c.id = p.checkin_id and c.proof_type = 'photo'
     where p.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "Not found.");
  return fileResponse(await storage.open(rows[0].proof_storage, rows[0].proof));
}

/* ---------- Router ---------- */

async function route(request, path) {
  const user = await requireUser(request);
  const m = request.method;
  const body = await readBody(request);
  let id;

  if (path === "posts" && m === "GET") return json({ posts: await listPosts(user) });
  if (path === "share" && m === "POST") return json(await shareCheckin(user, body), 201);
  if ((id = path.match(/^posts\/(\d+)$/)?.[1]) && m === "DELETE") return json(await deletePost(user, postId(id)));
  if ((id = path.match(/^posts\/(\d+)\/like$/)?.[1]) && m === "POST") return json(await toggleLike(user, postId(id)));
  if ((id = path.match(/^posts\/(\d+)\/comments$/)?.[1]) && m === "POST") return json(await addComment(user, postId(id), body), 201);
  if ((id = path.match(/^posts\/(\d+)\/photo$/)?.[1]) && m === "GET") return postPhoto(postId(id));
  throw new HttpError(404, "Not found.");
}

export default handler("communities", route);
