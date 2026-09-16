from dmgbuild.__main__ import main
import dmgbuild.core


original_hdiutil = dmgbuild.core.hdiutil


def hdiutil_with_forced_detach(command, *args, **kwargs):
    if command == "detach" and "-force" not in args:
        args = ("-force", *args)
    return original_hdiutil(command, *args, **kwargs)


dmgbuild.core.hdiutil = hdiutil_with_forced_detach
main()