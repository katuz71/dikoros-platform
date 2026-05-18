"""Temporary startup hook for legacy FastAPI route protection.

The monolithic main.py is being split into explicit routers. Until that work is
finished, this file installs the admin route guard before routes are registered.
"""

from services.security import install_admin_route_guard


install_admin_route_guard()
