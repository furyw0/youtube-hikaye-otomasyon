/**
 * MongoDB Native Client
 * NextAuth MongoDB Adapter için gerekli
 */

import { MongoClient, ServerApiVersion } from 'mongodb';

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

const uri = process.env.MONGODB_URI;

if (!uri) {
  // Build sırasında hata vermesin
  console.warn('MONGODB_URI environment variable is not defined');
}

const options = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
};

let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === 'development') {
  // Development'ta global cache kullan
  if (!global._mongoClientPromise && uri) {
    const client = new MongoClient(uri, options);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise!;
} else {
  // Production'da yeni client oluştur
  if (uri) {
    const client = new MongoClient(uri, options);
    clientPromise = client.connect();
  } else {
    clientPromise = Promise.reject(new Error('MONGODB_URI is not defined'));
  }
}

export default clientPromise;

