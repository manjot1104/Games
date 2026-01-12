# How to Give Free Access to Employees and Boss

## Quick Guide

You can give free access to Therapy Progress for specific users (employees, boss, etc.) in **two ways**:

---

## Method 1: Using Environment Variable (Recommended for Production)

**Best for**: Production deployments, multiple employees, easy management

### Steps:

1. **Find the Auth0 User ID** for each person:
   - Option A: Check browser console when they log in
   - Option B: Go to Auth0 Dashboard → Users → Select user → Copy "User ID"
   - Format: Usually looks like `auth0|60f7b3c4d5e6f7a8b9c0d1e2`

2. **Add to Backend `.env` file**:
   ```env
   # Free access for employees and boss
   FREE_ACCESS_IDS=auth0|boss_id_here,auth0|employee1_id,auth0|employee2_id,auth0|employee3_id
   ```

3. **Restart your backend server**:
   ```bash
   # If using npm
   npm restart
   
   # If using node directly
   # Stop and start the server
   ```

4. **Done!** These users will now have free access to Therapy Progress.

### Example:
```env
# Backend .env file
FREE_ACCESS_IDS=auth0|60f7b3c4d5e6f7a8b9c0d1e2,auth0|70f8c4d5e6f7a8b9c0d1e2f3,auth0|80f9d5e6f7a8b9c0d1e2f3a4
```

---

## Method 2: Adding Directly in Code

**Best for**: Quick testing, small team, development

### Steps:

1. **Open** `backend/routes/subscription.js`

2. **Find** the `FREE_ACCESS_IDS` array (around line 46)

3. **Add** Auth0 IDs to the array:
   ```javascript
   const FREE_ACCESS_IDS = [
     'auth0_test_user',
     'dev_local_tester',
     // Add your employees/boss here:
     'auth0|your_boss_id_here',
     'auth0|employee1_id_here',
     'auth0|employee2_id_here',
     ...(process.env.FREE_ACCESS_IDS ? process.env.FREE_ACCESS_IDS.split(',').map(id => id.trim()).filter(Boolean) : []),
   ].filter(Boolean);
   ```

4. **Restart** your backend server

---

## How to Find Auth0 User ID

### Method 1: Browser Console (Easiest)

1. Have the user log in to your app
2. Open browser Developer Tools (F12)
3. Go to Console tab
4. Look for logs containing `auth0Id` or check the network requests
5. The Auth0 ID will be in the format: `auth0|xxxxxxxxxxxxx`

### Method 2: Auth0 Dashboard

1. Go to [Auth0 Dashboard](https://manage.auth0.com)
2. Navigate to **Users** → **User Management**
3. Find and click on the user
4. Copy the **User ID** field (starts with `auth0|`)

### Method 3: Check Backend Logs

1. When user logs in, check backend console logs
2. Look for: `[SUBSCRIPTION STATUS] Checking status for auth0Id: auth0|xxxxx`
3. Copy the auth0Id from the log

---

## Verify It's Working

1. **Have the user log in**
2. **Navigate to Therapy Progress** tab
3. **Check backend logs** - you should see:
   ```
   [FREE ACCESS] User auth0|xxxxx has free access. Whitelisted: true
   ```
4. **User should see** Therapy Progress screen (not Paywall)

---

## Important Notes

### ⚠️ Testing Mode

If you're testing the Paywall and want to temporarily disable free access:

**In backend `.env`**:
```env
DISABLE_FREE_ACCESS_FOR_TESTING=true
```

This will disable free access for ALL users (including whitelisted ones) so you can test the payment flow.

**To re-enable free access**, remove this line or set it to `false`:
```env
DISABLE_FREE_ACCESS_FOR_TESTING=false
```

### 🔒 Security

- Auth0 IDs are safe to store in environment variables
- They're not sensitive credentials
- Only users with these IDs will get free access

### 📝 Multiple Users

You can add as many users as needed:
```env
FREE_ACCESS_IDS=auth0|id1,auth0|id2,auth0|id3,auth0|id4,auth0|id5
```

No limit on the number of users!

---

## Troubleshooting

### User still sees Paywall?

1. **Check backend logs**:
   ```
   [FREE ACCESS] User auth0|xxxxx does NOT have free access. Whitelisted: false
   ```
   - If `Whitelisted: false`, the ID is not in the whitelist
   - Double-check the Auth0 ID is correct

2. **Verify environment variable**:
   - Make sure `FREE_ACCESS_IDS` is set in backend `.env`
   - Restart backend server after adding

3. **Check for typos**:
   - Auth0 IDs are case-sensitive
   - Make sure there are no extra spaces
   - Format should be: `auth0|xxxxxxxxxxxxx`

4. **Check testing mode**:
   - If `DISABLE_FREE_ACCESS_FOR_TESTING=true`, free access is disabled
   - Set to `false` or remove it

### How to remove free access?

Simply remove the Auth0 ID from:
- Environment variable `FREE_ACCESS_IDS`, OR
- The `FREE_ACCESS_IDS` array in code

Then restart the backend server.

---

## Example: Adding Your Boss

1. **Get boss's Auth0 ID**: `auth0|60f7b3c4d5e6f7a8b9c0d1e2`

2. **Add to backend `.env`**:
   ```env
   FREE_ACCESS_IDS=auth0|60f7b3c4d5e6f7a8b9c0d1e2
   ```

3. **Restart backend**

4. **Boss logs in** → Has free access! ✅

---

## Example: Adding Multiple Employees

1. **Get all employee Auth0 IDs**:
   - Employee 1: `auth0|70f8c4d5e6f7a8b9c0d1e2f3`
   - Employee 2: `auth0|80f9d5e6f7a8b9c0d1e2f3a4`
   - Employee 3: `auth0|90f0e6f7a8b9c0d1e2f3a4b5`

2. **Add to backend `.env`** (comma-separated):
   ```env
   FREE_ACCESS_IDS=auth0|70f8c4d5e6f7a8b9c0d1e2f3,auth0|80f9d5e6f7a8b9c0d1e2f3a4,auth0|90f0e6f7a8b9c0d1e2f3a4b5
   ```

3. **Restart backend**

4. **All employees have free access!** ✅

---

## Summary

✅ **Easiest Method**: Add to `FREE_ACCESS_IDS` environment variable  
✅ **No Code Changes Needed**: Just update `.env` file  
✅ **Works Immediately**: After restarting backend  
✅ **Unlimited Users**: Add as many as you need  
✅ **Easy to Remove**: Just delete the ID from the list  

**File to edit**: `backend/.env`  
**Variable name**: `FREE_ACCESS_IDS`  
**Format**: `auth0|id1,auth0|id2,auth0|id3`





