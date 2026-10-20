import { api } from './api.js';

/**
 * The directory is master data shared by every claim screen. The app loads it
 * once at start-up and every later consumer reuses the same in-memory value, so
 * opening the assignment dialog never issues another request.
 */
let cachedDirectory = null;
let pendingDirectory = null;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function teamCode(team) {
  if (typeof team === 'string') return team.trim();
  if (team && typeof team === 'object') return text(team.code) || text(team.value);
  return '';
}

function humanizeCode(code) {
  const words = code.replace(/_/g, ' ').toLowerCase();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : code;
}

/**
 * Normalizes the directory payload into the shapes the assignment dialog uses.
 * It tolerates string team codes as well as `{ code, label }` entries because
 * people teams are stored as codes while the team list carries both.
 */
export function normalizeDirectory(payload) {
  const rawPeople = Array.isArray(payload?.people) ? payload.people : [];
  const people = rawPeople
    .map((person) => {
      if (!person || typeof person !== 'object') return null;
      const displayName = text(person.displayName) || text(person.name);
      if (!displayName) return null;
      const rawTeams = Array.isArray(person.teams)
        ? person.teams
        : Array.isArray(person.teamCodes)
          ? person.teamCodes
          : [];
      const teams = [];
      for (const entry of rawTeams) {
        const code = teamCode(entry);
        if (code && !teams.includes(code)) teams.push(code);
      }
      return {
        id: text(person.id) || displayName,
        displayName,
        email: text(person.email),
        role: text(person.role),
        teams
      };
    })
    .filter(Boolean);

  const rawTeams = Array.isArray(payload?.teams) ? payload.teams : [];
  const seen = new Set();
  const teams = [];
  for (const entry of rawTeams) {
    const code = teamCode(entry);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const label = entry && typeof entry === 'object' ? text(entry.label) || text(entry.name) : '';
    teams.push({ code, label: label || humanizeCode(code) });
  }

  return { people, teams };
}

export function loadDirectory() {
  if (cachedDirectory) return Promise.resolve(cachedDirectory);
  if (pendingDirectory) return pendingDirectory;
  pendingDirectory = api.directory
    .get()
    .then((payload) => {
      const normalized = normalizeDirectory(payload);
      cachedDirectory = normalized;
      return normalized;
    })
    .finally(() => {
      pendingDirectory = null;
    });
  return pendingDirectory;
}

/** Test and shell hooks for reading/clearing the process-local cache. */
export function getCachedDirectory() {
  return cachedDirectory;
}

export function resetDirectoryCache() {
  cachedDirectory = null;
  pendingDirectory = null;
}
