const groupIdPattern = /^(?:general|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i;

function validGroupId(id: string | null | undefined) {
  return id && groupIdPattern.test(id) ? id : null;
}

export function groupIdFromPath(pathname: string) {
  return validGroupId(/^\/grupos\/([^/]+)\/?$/.exec(pathname)?.[1]);
}

export function groupIdFromSearch(search: string) {
  return validGroupId(new URLSearchParams(search).get("grupo"));
}

export function groupPath(id: string) {
  return `/grupos/${id}`;
}

export function groupAuthPath(path: "/entrar" | "/bienvenida", id: string | null) {
  return id ? `${path}?${new URLSearchParams({ grupo: id })}` : path;
}
