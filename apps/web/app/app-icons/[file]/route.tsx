/**
 * PNG app icons (manifest 192/512/maskable, iOS apple-touch-icon), drawn from
 * the SVG in lib/pwa/icons.ts and prerendered at build time.
 *
 * Not the `icon.tsx` / `apple-icon.tsx` file conventions on purpose: those are
 * served at `/icon` and `/apple-icon` (no extension), which the locale proxy
 * would redirect to `/fr/icon`. `/app-icons/<name>.png` has an extension, so
 * the proxy leaves it alone.
 */
import { ImageResponse } from "next/og";

import { APP_ICONS, findAppIcon, iconDataUri } from "@/lib/pwa/icons";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams(): Array<{ file: string }> {
  return APP_ICONS.map(({ file }) => ({ file }));
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/app-icons/[file]">,
): Promise<Response> {
  const icon = findAppIcon((await ctx.params).file);
  if (!icon) return new Response("Not found", { status: 404 });
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img> */}
      <img src={iconDataUri(icon.variant)} width={icon.size} height={icon.size} alt="" />
    </div>,
    { width: icon.size, height: icon.size },
  );
}
