import axios from 'axios';
import mongoose from 'mongoose';
import Redis from 'ioredis';
import 'dotenv/config';

const BACKEND_URL = 'http://localhost:4000';
const PY_BACKEND_URL = 'http://localhost:8000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/open_assets';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

async function testConnectivity() {
  console.log('🔍 Starting open_assets Pipeline & Connectivity Test...\n');

  // 1. Check Redis
  console.log('📡 Testing Redis Connection...');
  try {
    const redis = new Redis(REDIS_URL);
    const ping = await redis.ping();
    console.log(`✅ Redis: Ping OK (${ping})`);
    redis.disconnect();
  } catch (err: any) {
    console.error(`❌ Redis: Failed to connect (${err.message})`);
  }

  // 2. Check MongoDB
  console.log('\n🍃 Testing MongoDB Connection...');
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`✅ MongoDB: Connected successfully to ${mongoose.connection.name}`);
    await mongoose.disconnect();
  } catch (err: any) {
    console.error(`❌ MongoDB: Failed to connect (${err.message})`);
  }

  // 3. Check Express Backend Health
  console.log('\n🚀 Testing Express Backend Health (Port 4000)...');
  try {
    const res = await axios.get(`${BACKEND_URL}/health`);
    console.log(`✅ Express Backend: Active (Status: ${res.data.status})`);
  } catch (err: any) {
    console.error(`❌ Express Backend: Unreachable on ${BACKEND_URL} (${err.message})`);
  }

  // 4. Check Python FastAPI AI Service Health
  console.log('\n🐍 Testing Python AI Service Health (Port 8000)...');
  try {
    const res = await axios.get(`${PY_BACKEND_URL}/health`);
    console.log(`✅ Python AI Service: Active (Status: ${res.data.status})`);
  } catch (err: any) {
    console.error(`❌ Python AI Service: Unreachable on ${PY_BACKEND_URL} (${err.message})`);
  }

  // 5. Check Cloudinary Configuration
  console.log('\n☁️ Checking Cloudinary Configurations...');
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (cloudName && apiKey && apiSecret) {
    console.log(`✅ Cloudinary: Configured (Cloud Name: ${cloudName})`);
  } else {
    console.log(`⚠️ Cloudinary: Configuration is missing in backend/.env!`);
    console.log(`   Both original uploads and asset cropping will fail without Cloudinary API credentials.`);
  }

  console.log('\n🏁 Connectivity check complete. Run with Cloudinary config to test the complete upload & export loops.');
}

testConnectivity().catch(console.error);
