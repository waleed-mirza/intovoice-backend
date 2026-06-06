import jwt from "jsonwebtoken";
import prisma from "./prismaClient";

const verifyToken = async (req: any, res: any, next: any) => {
  try {
    const cookieToken = req.cookies?.token;
    const authHeader = req.headers.authorization;
    const headerToken = authHeader ? authHeader.split(" ")[1] : undefined;

    const token = cookieToken || headerToken;

    if (!token) {
      return res.status(401).json({ message: "Token is required" });
    }

    const decoded: any = jwt.verify(token, process.env.SECRET_KEY);

    if (!decoded?.id) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // Reject tokens belonging to anonymized/deleted accounts. Pulls the
    // single boolean column so existing JWTs stop working immediately
    // after self-service deletion.
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, isDeleted: true },
    });

    if (!user || user.isDeleted) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    req.userId = decoded.id;
    next();
  } catch (err: any) {
    console.log(err.message);
    return res.status(401).json({ message: "Unauthorized" });
  }
};

export default verifyToken;
