// Errors shared by the messaging facade (lib/messaging/index.js) and its providers.
export class CannotDeliver extends Error {}       // channel rules forbid this send (e.g. WhatsApp 24 h window)
export class VerificationFailed extends Error {}  // message is safe to show the user
export class InvalidSignature extends Error {}
