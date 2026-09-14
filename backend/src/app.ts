import express from "express";
import healthRouter from "./routes/health";
import assetsRouter from "./routes/assets";
import intentRouter from "./routes/intent";
import agentRouter from "./routes/agent";
import sessionRouter from "./routes/session";
import accountRouter from "./routes/account";

const app = express();

app.use(express.json());
app.use(healthRouter);
app.use(assetsRouter);
app.use(intentRouter);
app.use(agentRouter);
app.use(sessionRouter);
app.use(accountRouter);

export default app;
