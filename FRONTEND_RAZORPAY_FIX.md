# ✅ Frontend Razorpay Key Fix

## Problem
```
Razorpay key is missing
```

## Solution

### Step 1: Root `.env` File me Add Karo

Root directory (project root, not backend/) me `.env` file me yeh add karo:

```env
EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx
```

**Important:**
- File location: Root directory me (same level as `package.json`)
- Variable name: `EXPO_PUBLIC_RAZORPAY_KEY_ID` (EXPO_PUBLIC_ prefix zaroori hai)
- Value: Same key ID jo backend me use ki hai

### Step 2: Get Key ID from Backend

Backend `.env` me jo `RAZORPAY_KEY_ID` hai, wahi value frontend me bhi use karo:

```env
# Backend .env
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx

# Frontend .env (root)
EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx  # Same value!
```

### Step 3: Restart Frontend App

**CRITICAL**: `.env` file me changes ke baad frontend app **MUST restart** karo!

1. Expo dev server stop karo (Ctrl+C)
2. Phir se start karo:
   ```bash
   npm start
   # ya
   expo start
   ```

### Step 4: Verify in Browser Console

Browser console me check karo:

```javascript
console.log('Razorpay Key:', process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID);
```

Agar key properly load ho rahi hai, to yeh dikhega:
```
Razorpay Key: rzp_live_xxxxxxxxxxxxx
```

## File Structure

```
project-root/
├── .env                    ← Frontend .env (EXPO_PUBLIC_RAZORPAY_KEY_ID)
├── package.json
├── app/
├── components/
└── backend/
    └── .env                ← Backend .env (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)
```

## Quick Checklist

- [ ] Root `.env` file me `EXPO_PUBLIC_RAZORPAY_KEY_ID` add kiya
- [ ] Key ID same hai jo backend me hai
- [ ] Frontend app restart kiya
- [ ] Browser console me key verify kiya

## Still Not Working?

1. Check `.env` file location (root directory me honi chahiye)
2. Check variable name (`EXPO_PUBLIC_` prefix zaroori hai)
3. Check key value (same as backend)
4. Frontend app restart kiya? (Expo cache clear karo agar zaroorat ho)
