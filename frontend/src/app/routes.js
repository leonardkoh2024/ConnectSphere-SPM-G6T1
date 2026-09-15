// Navigation is hash-based (`#/{role}/{screen}`) — there is no router library, and
// one is not to be added without the team agreeing. This module owns the hash
// format so that nothing else has to know how a screen name becomes a URL.

export const screenHash = (role, name) => `#/${role.toLowerCase()}/${encodeURIComponent(name.toLowerCase().replaceAll(" ", "-"))}`;
