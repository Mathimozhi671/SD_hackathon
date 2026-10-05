/**
 * Real Redis Lua Scripts for Flash Sale Inventory Management.
 * Redis processes these atomically in a single thread, preventing any race conditions.
 */

// 1. Atomic Reservation Script
// KEYS[1]: flash_sale:stock:{sale_id}
// KEYS[2]: flash_sale:users:{sale_id}
// KEYS[3]: flash_sale:res:{token}
// ARGV[1]: user_id
// ARGV[2]: token
// ARGV[3]: ttl_seconds
export const LUA_RESERVE_STOCK = `
local user_set_key = KEYS[2]
local stock_key = KEYS[1]
local reservation_key = KEYS[3]

local user_id = ARGV[1]
local token = ARGV[2]
local ttl = tonumber(ARGV[3])

-- 1. Check if user already reserved or purchased
if redis.call('SISMEMBER', user_set_key, user_id) == 1 then
    return cjson.encode({ status = 'DUPLICATE_USER', message = 'User has already reserved or purchased this product.' })
end

-- 2. Check stock availability
local current_stock = tonumber(redis.call('GET', stock_key) or 0)
if current_stock <= 0 then
    return cjson.encode({ status = 'SOLD_OUT', message = 'Stock exhausted. No units available.' })
end

-- 3. Atomic Decrement and Registration
redis.call('DECRBY', stock_key, 1)
redis.call('SADD', user_set_key, user_id)
redis.call('SETEX', reservation_key, ttl, user_id)

return cjson.encode({
    status = 'RESERVED',
    remaining_stock = current_stock - 1,
    reservation_token = token,
    ttl = ttl
})
`;

// 2. Atomic Release / Cancel Script (Restock on payment failure or cancellation)
// KEYS[1]: flash_sale:stock:{sale_id}
// KEYS[2]: flash_sale:users:{sale_id}
// KEYS[3]: flash_sale:res:{token}
// ARGV[1]: user_id
export const LUA_RELEASE_STOCK = `
local stock_key = KEYS[1]
local user_set_key = KEYS[2]
local reservation_key = KEYS[3]
local user_id = ARGV[1]

-- Check if reservation exists
local exists = redis.call('EXISTS', reservation_key)
if exists == 1 then
    redis.call('DEL', reservation_key)
    redis.call('INCRBY', stock_key, 1)
    redis.call('SREM', user_set_key, user_id)
    local updated_stock = tonumber(redis.call('GET', stock_key))
    return cjson.encode({ status = 'RELEASED', restored_stock = updated_stock })
else
    -- Even if reservation key expired, remove from user set to allow re-attempt if configured
    redis.call('SREM', user_set_key, user_id)
    return cjson.encode({ status = 'ALREADY_EXPIRED_OR_ABSENT' })
end
`;

// 3. Atomic Commit Script (Upon confirmed payment)
// KEYS[1]: flash_sale:res:{token}
// KEYS[2]: flash_sale:committed:{sale_id}
// ARGV[1]: user_id
// ARGV[2]: token
export const LUA_COMMIT_STOCK = `
local reservation_key = KEYS[1]
local committed_set_key = KEYS[2]
local user_id = ARGV[1]
local token = ARGV[2]

-- Remove the temporary TTL reservation hold
redis.call('DEL', reservation_key)
-- Mark permanently in committed set
redis.call('SADD', committed_set_key, user_id)

return cjson.encode({ status = 'COMMITTED', token = token })
`;
