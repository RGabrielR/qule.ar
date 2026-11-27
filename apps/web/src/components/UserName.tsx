/** Aísla la dirección del nombre del texto que lo rodea. */
export function UserName({ name }: { name: string }) {
  return <bdi>{name}</bdi>;
}
