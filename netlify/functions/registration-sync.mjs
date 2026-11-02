
export default async function handler() {
  return Response.json(
    { status: "not_available" },
    { status: 404 }
  );
}
