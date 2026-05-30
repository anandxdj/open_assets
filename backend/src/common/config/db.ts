import mongoose from 'mongoose';

export const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI;
    if (!mongoURI) {
      throw new Error("MONGO_URI is missing in .env file");
    }

    const options: mongoose.ConnectOptions = {};
    if (process.env.MONGO_DB_NAME) {
      options.dbName = process.env.MONGO_DB_NAME;
    }

    const conn = await mongoose.connect(mongoURI, options);
    console.log(`[MongoDB] Connected: ${conn.connection.host} 🍃`);
  } catch (error) {
    console.error(`[MongoDB] Connection Error:`, error);
    process.exit(1);
  }
};