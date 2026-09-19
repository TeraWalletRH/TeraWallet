import "dotenv/config";
import app from "./app";
import { migrate } from "./db/migrate";
import { startStakingPayoutExecutor } from "./staking-executor";
import { startPrivateSendExecutor } from "./private-send";
import { startPrivateBridgeExecutor } from "./private-bridge";

const PORT = Number(process.env.PORT) || 3001;

async function bootstrap() {
  try {
    if (process.env.DATABASE_URL) {
      console.log("Running database migrations...");
      await migrate();
      console.log("Database migrations completed.");
    } else {
      console.warn("DATABASE_URL not configured, skipping migrations.");
    }

    app.listen(PORT, () => {
      console.log(`Tera Wallet backend listening on port ${PORT}`);
      startStakingPayoutExecutor();
      startPrivateSendExecutor();
      startPrivateBridgeExecutor();
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

bootstrap();
