// Vercel entry point: the whole Express app runs as one serverless function (see vercel.json for the rewrites).
// Static files in /public are served by Vercel's CDN directly.
import { createApp } from '../src/app.js';

export default createApp();
