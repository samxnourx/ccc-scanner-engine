import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ leadDiscoveryId: string }>;
};

/** Legacy PDF URL — printable HTML report replaced server-side PDFKit. */
export async function GET(request: Request, context: RouteContext) {
  const { leadDiscoveryId } = await context.params;
  const id = decodeURIComponent(leadDiscoveryId).trim();
  if (!id) {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = new URL(
    `/scanner/leads/${encodeURIComponent(id)}/report`,
    request.url,
  );
  return NextResponse.redirect(url, 307);
}
