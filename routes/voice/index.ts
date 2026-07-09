import { Router } from "express";
import jwt from "jsonwebtoken";
import verifyToken from "../../middlewares/verifyToken";
import stationRouter from "./station";
import postRouter from "./post";
import commentRouter from "./comment";
import feedRouter from "./feed";
import categoryRouter from "./category";
import uploadRouter from "./upload";
import liveRouter from "./live";
import tapeRouter from "./tape";
import userRouter from "./user";

const router = Router();

// Reusable optional-auth middleware.
// JWT is signed as { id: user.id } — use decoded.id (NOT decoded.userId).
const optionalAuth = (req: any, res: any, next: any) => {
  const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];
  if (token) {
    try {
      const decoded: any = jwt.verify(token, process.env.SECRET_KEY as string);
      req.userId = decoded.id;
    } catch (e) {
      // Ignore — user is not authenticated
    }
  }
  next();
};

// Upload routes - protected (need auth to upload)
router.use("/upload", verifyToken, uploadRouter);

// Live stream routes — all require auth (/active and /my-active before /:id in live.ts)
router.use("/live", verifyToken, liveRouter);

// Feed — subscriptions requires auth inside feed.ts; other feed routes are public
router.use("/feed", optionalAuth, feedRouter);
router.use("/category", optionalAuth, categoryRouter);

// Station / post / comment — mount with optionalAuth so public GETs work logged out.
// Write routes (create, edit, delete, like, subscribe) use verifyToken inside each file.
// Do NOT use router.get(..., subRouter): remaining path won't match nested routes and
// requests fall through to a verifyToken mount (401 for anonymous users).
router.use("/station", optionalAuth, stationRouter);
router.use("/post", optionalAuth, postRouter);
router.use("/comment", optionalAuth, commentRouter);

// Tape routes — optional auth on reads; writes use verifyToken inside tape.ts
router.use("/tape", optionalAuth, tapeRouter);

// Public user profiles
router.use("/user", optionalAuth, userRouter);

export default router;
