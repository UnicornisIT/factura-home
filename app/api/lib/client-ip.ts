import { isIP, SocketAddress } from "node:net";

export function normalizeIp(address: string | null | undefined) {
  if (!address || address.includes("%")) return;
  if (isIP(address) === 4) return address;
  if (isIP(address) === 6)
    return new SocketAddress({ address, family: "ipv6" }).address.replace(
      /^::ffff:(?=\d+\.)/,
      ""
    );
}

export function clientIp(
  remoteAddress: string | undefined,
  realIp: string | null,
  trustedProxyIp: string | undefined
) {
  const peer = normalizeIp(remoteAddress);
  return (
    (peer && peer === trustedProxyIp ? normalizeIp(realIp) : undefined) ??
    peer ??
    "local"
  );
}
