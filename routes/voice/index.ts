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

// Feed routes — subscriptions requires auth; others optional
router.get("/feed/subscriptions", verifyToken, feedRouter);
router.use("/feed", optionalAuth, feedRouter);
router.use("/category", optionalAuth, categoryRouter);

// Station routes - some public, some protected
router.get("/station/check-handle/:handle", stationRouter);
router.get("/station/handle/:handle", optionalAuth, stationRouter);

// Subscribed stations - needs auth, must be before /:id to avoid conflict
router.get("/station/subscribed", verifyToken, stationRouter);
router.get("/station/my-stations", verifyToken, stationRouter);

router.get("/station/:id", optionalAuth, stationRouter);

// Protected station routes
router.use("/station", verifyToken, stationRouter);

// Post routes - some public, some protected
router.get("/post/station/:stationId", postRouter);
router.get("/post/:id", optionalAuth, postRouter);
router.get("/post/:id/related", postRouter);

// Protected post routes
router.use("/post", verifyToken, postRouter);

// Comment routes - GET is public with optional auth, others protected
router.get("/comment/post/:postId", optionalAuth, commentRouter);
router.get("/comment/:commentId/replies", optionalAuth, commentRouter);

// Protected comment routes
router.use("/comment", verifyToken, commentRouter);

export default router;
