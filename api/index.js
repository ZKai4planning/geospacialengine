// Vercel entry point: the whole Express app runs as one serverless function (see vercel.json for the rewrites).
// Static files in /public are served by Vercel's CDN directly.
//
// The app is created lazily and any startup error (bad env var, missing package, unreachable config...) is logged
// to the Vercel runtime logs AND returned as a short JSON message, instead of an opaque FUNCTION_INVOCATION_FAILED.
let app;
let failure;

const describe = (e) => {
  if (Array.isArray(e?.issues)) return e.issues.map((i) => `${i.path?.join('.') || '(root)'}: ${i.message}`).join('; '); // zod config errors
  return e?.message ?? String(e);
};

export default async function handler(req, res) {
  if (!app && !failure) {
    try {
      const { createApp } = await import('../src/app.js');
      app = createApp();
    } catch (e) {
      failure = e;
      console.error('STARTUP FAILED:', e);
    }
  }
  if (failure) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'startup_failed', message: describe(failure) }));
    return;
  }
  return app(req, res);
}
