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

const app = express();

app.use(requestIdMiddleware);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
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
app.use(retentionRouter);
app.use(mobileRouter);
app.use(assetsRouter);
app.use(intentRouter);
app.use(agentRouter);
app.use(sessionRouter);
app.use(accountRouter);

export default app;
