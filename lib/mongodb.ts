import mongoose from 'mongoose';
import { logger } from './logger';

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

/**
 * MongoDB bağlantı yöneticisi
 * Stale connection'ları tespit eder ve yeniden bağlanır
 */
async function dbConnect(forceNew: boolean = false) {
  const MONGODB_URI = process.env.MONGODB_URI;
  
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not defined');
  }

  // Force new connection istenirse veya bağlantı stale ise
  if (forceNew && cached.conn) {
    logger.info('MongoDB: Force new connection requested, closing existing...');
    try {
      await mongoose.connection.close();
    } catch (e) {
      // Bağlantı kapatma hatası kritik değil
    }
    cached.conn = null;
    cached.promise = null;
  }

  // Mevcut bağlantıyı kontrol et
  if (cached.conn) {
    // Bağlantı durumunu kontrol et (1 = connected)
    if (mongoose.connection.readyState === 1) {
      return cached.conn;
    } else {
      // Bağlantı kopmuş, yeniden bağlan
      logger.warn('MongoDB: Connection stale, reconnecting...', {
        readyState: mongoose.connection.readyState
      });
      cached.conn = null;
      cached.promise = null;
    }
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000, // 10 saniye (varsayılan 30sn yerine)
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 2,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      logger.info('MongoDB connected successfully');
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    logger.error('MongoDB connection failed', { error: e });
    throw e;
  }

  return cached.conn;
}

/**
 * Yeni bağlantı ile veritabanı işlemi yapar
 * Stale connection sorunlarını önler
 */
export async function dbConnectFresh() {
  return dbConnect(true);
}

export default dbConnect;

// Type for global mongoose cache
declare global {
  // eslint-disable-next-line no-var
  var mongoose: {
    conn: any;
    promise: any;
  };
}

