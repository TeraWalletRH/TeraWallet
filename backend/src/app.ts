import express from "express";
import healthRouter from "./routes/health";
import intentRouter from "./routes/intent";

const app = express();

app.use(express.json());
app.use(healthRouter);
app.use(intentRouter);

export default app;
