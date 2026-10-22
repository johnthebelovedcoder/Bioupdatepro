-- Account-wide failed-password lockouts caused valid users to be denied
-- access and are no longer part of the sign-in flow.
DROP TABLE IF EXISTS "login_failure_windows";
