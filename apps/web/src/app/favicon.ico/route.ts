const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1f6b3f"/><path d="M18 39c13-1 23-10 28-24 2 18-7 34-25 34-6 0-10-4-10-9 0-6 5-10 11-10" fill="#fff"/><path d="M16 49c8-10 17-17 29-24" fill="none" stroke="#1f6b3f" stroke-linecap="round" stroke-width="3"/></svg>`;

export function GET() {
  return new Response(favicon, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}