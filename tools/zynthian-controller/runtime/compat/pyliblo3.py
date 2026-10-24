# SPDX-License-Identifier: GPL-2.0-or-later
"""Ubuntu's packaged OSC binding exports the liblo API used by this application.

The source archive calls this binding pyliblo3; the desktop runtime packages it
as liblo. Keep the alias confined to the controller runtime's PYTHONPATH.
"""
from liblo import *  # noqa: F403
