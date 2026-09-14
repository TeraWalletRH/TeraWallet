import express from "express";
import healthRouter from "./routes/health";
import assetsRouter from "./routes/assets";
import intentRouter from "./routes/intent";
import agentRouter from "./routes/agent";
import sessionRouter from "./routes/session";
import accountRouter from "./routes/account";

const app = express();

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

app.use(express.json());

app.use(healthRouter);
app.use(assetsRouter);
app.use(intentRouter);
app.use(agentRouter);
app.use(sessionRouter);
app.use(accountRouter);

export default app;
