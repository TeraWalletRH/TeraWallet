import express from "express";
import healthRouter from "./routes/health";
import assetsRouter from "./routes/assets";
import intentRouter from "./routes/intent";
import agentRouter from "./routes/agent";
import sessionRouter from "./routes/session";
import accountRouter from "./routes/account";
import { requestIdMiddleware } from "./logging";
import policyRouter from "./routes/policy";
import bridgeRouter from "./routes/bridge";
import retentionRouter from "./routes/retention";
import mobileRouter from "./routes/mobile";
import ohttpRouter from "./routes/ohttp";
import pricesRouter from "./routes/prices";
import stakingRouter from "./routes/staking";
import privateSendRouter from "./routes/private-send";
import privateBridgeRouter from "./routes/private-bridge";
import tagsRouter from "./routes/tags";
import leaderboardRouter from "./routes/leaderboard";

const app = express();

app.use(requestIdMiddleware);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = new Set(["https://terawallet.app", "https://www.terawallet.app", "http://localhost:5173"]);
  if (origin && allowedOrigins.has(origin)) res.header("Access-Control-Allow-Origin", origin);
  else res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// The Oblivious HTTP gateway takes a raw capsule body, so it is mounted ahead
// of the JSON parser and brings its own.
app.use(ohttpRouter);

app.use(express.json());

app.use(healthRouter);
app.use(policyRouter);
app.use(bridgeRouter);
app.use(privateBridgeRouter);
app.use(retentionRouter);
app.use(mobileRouter);
app.use(pricesRouter);
app.use(stakingRouter);
app.use(privateSendRouter);
app.use(tagsRouter);
app.use(leaderboardRouter);
app.use(assetsRouter);
app.use(intentRouter);
app.use(agentRouter);
app.use(sessionRouter);
app.use(accountRouter);

export default app;
