-- Buffer publishes to Instagram, TikTok and Threads; its channels are stored as SocialAccount rows.
ALTER TYPE "Platform" ADD VALUE 'threads';
ALTER TYPE "PublisherKind" ADD VALUE 'buffer';
