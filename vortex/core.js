'use strict';

function modIdentity(input, requireSigned = false) {
  try {
    const url = new URL(input);
    if (url.protocol !== 'nxm:' || url.username || url.password || url.port) return null;
    if (!/^[a-z0-9_-]+$/i.test(url.hostname)) return null;
    const match = /^\/mods\/(\d+)\/files\/(\d+)\/?$/.exec(url.pathname);
    if (!match) return null;
    if (requireSigned && (!url.searchParams.get('key') || !/^\d+$/.test(url.searchParams.get('expires') || '') || Number(url.searchParams.get('expires')) * 1000 < Date.now())) return null;
    return { game: url.hostname.toLowerCase(), mod: match[1], file: match[2] };
  } catch { return null; }
}

function pageIdentity(input) {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !['www.nexusmods.com', 'nexusmods.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
    const match = /^\/([a-z0-9_-]+)\/mods\/(\d+)\/?$/i.exec(url.pathname);
    const file = url.searchParams.get('file_id');
    if (!match || !/^\d+$/.test(file || '') || url.searchParams.get('nmm') !== '1') return null;
    return { game: match[1].toLowerCase(), mod: match[2], file };
  } catch { return null; }
}

function sameIdentity(a, b) {
  return !!a && !!b && a.game === b.game && a.mod === b.mod && a.file === b.file;
}

function matchingDownload(state, identity) {
  const files = state?.persistent?.downloads?.files || {};
  return Object.values(files).some(download => {
    if (['failed', 'redirect'].includes(download.state)) return false;
    const info = download.modInfo || {};
    const ids = info.nexus?.ids || info.ids || {};
    if (String(ids.modId ?? info.modId) !== identity.mod || String(ids.fileId ?? info.fileId) !== identity.file) return false;
    const urlMatch = (download.urls || []).some(value => sameIdentity(modIdentity(value), identity));
    if (urlMatch) return true;
    const games = [ids.gameId, info.nexus?.modInfo?.game?.domainName, ...(Array.isArray(download.game) ? download.game : [download.game])].filter(Boolean).map(String);
    return games.some(game => game.toLowerCase() === identity.game);
  });
}

module.exports = { modIdentity, pageIdentity, sameIdentity, matchingDownload };
