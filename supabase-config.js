'use strict';
// Your Supabase project's address and public key. Both are meant to be visible
// in the page - the anon key only grants what the row level security policies
// in supabase-setup.sql allow, which is why that file matters.
//
// Find these in the dashboard under Project Settings -> API:
//   Project URL   ->  SUPABASE_URL
//   anon public   ->  SUPABASE_ANON_KEY   (the long one starting with eyJ...)
//
// Never paste the service_role key here. That one bypasses every policy.
window.WBPILL_CONFIG = {
    SUPABASE_URL: 'https://zqerslxtujwunwbwjgfn.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxZXJzbHh0dWp3dW53YndqZ2ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNDQyODAsImV4cCI6MjEwMjgyMDI4MH0.YNFUbV578p02y-ZhXR0vDSDD2dJKLZc80OMHhAb_X_g'
};
