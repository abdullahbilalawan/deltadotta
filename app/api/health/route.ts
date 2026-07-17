export function GET() {
  return Response.json({ status: "ok", service: "deltadotta" }, {
    headers: { "Cache-Control": "no-store" },
  });
}
