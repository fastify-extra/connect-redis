import { SessionStore } from "@fastify/session";
import type { RedisClientType, RedisClusterType } from "redis";

type Callback = (_err?: unknown, _data?: any) => any;

function optionalCb(err: unknown, data: unknown, cb?: Callback): unknown {
  if (cb) return cb(err, data);
  if (err) throw err as Error;
  return data;
}

export interface SessionData {
  cookie: {
    originalMaxAge: number | null;
    maxAge?: number;
    signed?: boolean;
    expires?: Date | null;
    httpOnly?: boolean;
    path?: string;
    domain?: string;
    secure?: boolean | "auto";
    sameSite?: boolean | "lax" | "strict" | "none";
  };
}

interface Serializer {
  parse(s: string): SessionData;
  stringify(s: SessionData): string;
}

interface RedisStoreOptions {
  client: unknown;
  prefix?: string;
  scanCount?: number;
  serializer?: Serializer;
  ttl?: number | ((sess: SessionData) => number);
  disableTTL?: boolean;
  disableTouch?: boolean;
}

export type TRedisClient = RedisClientType | RedisClusterType;

export class RedisStore implements SessionStore {
  client: TRedisClient;
  prefix: string;
  scanCount: number;
  serializer: Serializer;
  ttl: number | ((sess: SessionData) => number);
  disableTTL: boolean;
  disableTouch: boolean;

  constructor(opts: RedisStoreOptions) {
    this.prefix = opts.prefix == null ? "sess:" : opts.prefix;
    this.scanCount = opts.scanCount || 100;
    this.serializer = opts.serializer || JSON;
    this.ttl = opts.ttl || 86400; // One day in seconds.
    this.disableTTL = opts.disableTTL || false;
    this.disableTouch = opts.disableTouch || false;
    this.client = opts.client as TRedisClient;
  }

  get(sid: string, cb?: Callback): void {
    const key = this.prefix + sid;
    this.client
      .get(key)
      .then((data) => {
        if (!data) {
          optionalCb(null, null, cb);
          return;
        }
        optionalCb(null, this.serializer.parse(data), cb);
      })
      .catch((err) => {
        optionalCb(err, null, cb);
      });
  }

  set(sid: string, sess: SessionData, cb?: Callback): void {
    const key = this.prefix + sid;
    const ttl = this.getTTL(sess);
    Promise.resolve()
      .then(() => {
        if (ttl > 0) {
          const val = this.serializer.stringify(sess);
          if (this.disableTTL) {
            return this.client
              .set(key, val)
              .then(() => optionalCb(null, null, cb));
          } else {
            return this.client
              .set(key, val, { EX: ttl })
              .then(() => optionalCb(null, null, cb));
          }
        }
        return this.destroy(sid, cb);
      })
      .catch((err) => optionalCb(err, null, cb));
  }

  async touch(sid: string, sess: SessionData, cb?: Callback) {
    const key = this.prefix + sid;
    if (this.disableTouch || this.disableTTL) return optionalCb(null, null, cb);
    try {
      await this.client.expire(key, this.getTTL(sess));
      return optionalCb(null, null, cb);
    } catch (err) {
      return optionalCb(err, null, cb);
    }
  }

  destroy(sid: string, cb?: Callback): void {
    const key = this.prefix + sid;
    this.client
      .del([key])
      .then(() => {
        optionalCb(null, null, cb);
      })
      .catch((err) => {
        optionalCb(err, null, cb);
      });
  }

  async clear(cb?: Callback) {
    try {
      const keys = await this.getAllKeys();
      if (!keys.length) return optionalCb(null, null, cb);
      await this.client.del(keys);
      return optionalCb(null, null, cb);
    } catch (err) {
      return optionalCb(err, null, cb);
    }
  }

  async length(cb?: Callback) {
    try {
      const keys = await this.getAllKeys();
      return optionalCb(null, keys.length, cb);
    } catch (err) {
      return optionalCb(err, null, cb);
    }
  }

  async ids(cb?: Callback) {
    const len = this.prefix.length;
    try {
      const keys = await this.getAllKeys();
      return optionalCb(
        null,
        keys.map((k) => k.substring(len)),
        cb
      );
    } catch (err) {
      return optionalCb(err, null, cb);
    }
  }

  async all(cb?: Callback) {
    try {
      const keys = await this.getAllKeys();
      if (keys.length === 0) return optionalCb(null, [], cb);

      const data = await this.client.mGet(keys);
      const results = data.reduce((acc, raw) => {
        if (!raw) return acc;
        const sess = this.serializer.parse(raw);
        acc.push(sess);
        return acc;
      }, [] as SessionData[]);
      return optionalCb(null, results, cb);
    } catch (err) {
      return optionalCb(err, null, cb);
    }
  }

  private getTTL(sess: SessionData) {
    if (typeof this.ttl === "function") {
      return this.ttl(sess);
    }

    let ttl;
    if (sess?.cookie["expires"]) {
      const ms = Number(new Date(sess?.cookie["expires"])) - Date.now();
      ttl = Math.ceil(ms / 1000);
    } else {
      ttl = this.ttl;
    }
    return ttl;
  }

  private async getAllKeys() {
    const pattern = this.prefix + "*";
    const set = new Set<string>();
    for await (const keys of this.scanIterator(pattern, this.scanCount)) {
      for (const key of keys) {
        set.add(key);
      }
    }
    return set.size > 0 ? Array.from(set) : [];
  }

  private scanIterator(match: string, count: number) {
    const client = this.client;

    if (!("masters" in client)) {
      return client.scanIterator({ MATCH: match, COUNT: count });
    }

    return (async function* () {
      for (const master of client.masters) {
        const c = await client.nodeClient(master);
        for await (const keys of c.scanIterator({
          COUNT: count,
          MATCH: match,
        })) {
          yield keys;
        }
      }
    })();
  }
}
