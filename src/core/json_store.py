"""可靠的 JSON 文件读写、备份和损坏现场保留。"""

from __future__ import annotations

import json
import os
import shutil
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable


JsonValidator = Callable[[Any], None]


class JsonStoreError(RuntimeError):
    """JSON 存储操作失败。"""


class JsonValidationError(JsonStoreError):
    """JSON 内容不符合预期结构。"""


_locks_guard = threading.Lock()
_path_locks: dict[str, threading.RLock] = {}


def validate_json_object(data: Any) -> None:
    if not isinstance(data, dict):
        raise JsonValidationError("JSON 根节点必须是对象")


def _path_lock(path: str | os.PathLike) -> threading.RLock:
    key = str(Path(path).resolve())
    with _locks_guard:
        lock = _path_locks.get(key)
        if lock is None:
            lock = threading.RLock()
            _path_locks[key] = lock
        return lock


def read_json(path: str | os.PathLike, validator: JsonValidator | None = None) -> Any:
    """读取并可选验证 JSON；空文件视为损坏。"""
    json_path = Path(path)
    try:
        with json_path.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise JsonStoreError(f"无法读取 JSON 文件 {json_path.name}: {exc}") from exc

    if validator is not None:
        try:
            validator(data)
        except JsonValidationError:
            raise
        except Exception as exc:
            raise JsonValidationError(f"JSON 验证失败 {json_path.name}: {exc}") from exc
    return data


def read_json_with_backup(
    path: str | os.PathLike,
    *,
    validator: JsonValidator | None = None,
    default: Any = None,
    use_default_when_missing: bool = False,
) -> Any:
    """读取正式文件；损坏时尝试 .bak，并在成功后恢复正式文件。"""
    json_path = Path(path)
    if not json_path.exists():
        if use_default_when_missing:
            return default
        raise JsonStoreError(f"JSON 文件不存在: {json_path.name}")

    try:
        return read_json(json_path, validator)
    except JsonStoreError as primary_error:
        backup_path = json_path.with_name(json_path.name + ".bak")
        if not backup_path.exists():
            raise primary_error
        backup_data = read_json(backup_path, validator)
        atomic_write_json(
            json_path,
            backup_data,
            validator=validator,
            create_backup=False,
        )
        return backup_data


def _temporary_path(path: Path, purpose: str = "tmp") -> Path:
    return path.with_name(
        f".{path.name}.{os.getpid()}.{threading.get_ident()}.{purpose}"
    )


def _write_json_file(path: Path, payload: Any, encoder=None) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(
            payload,
            file,
            cls=encoder,
            indent=2,
            ensure_ascii=False,
        )
        file.write("\n")
        file.flush()
        os.fsync(file.fileno())


def _replace_backup(
    source: Path,
    backup: Path,
    validator: JsonValidator | None,
) -> None:
    """仅在旧文件有效时更新 .bak，避免用损坏文件覆盖好备份。"""
    read_json(source, validator)
    temp_backup = _temporary_path(backup, "backup")
    try:
        shutil.copy2(source, temp_backup)
        read_json(temp_backup, validator)
        os.replace(temp_backup, backup)
    finally:
        temp_backup.unlink(missing_ok=True)


def atomic_write_json(
    path: str | os.PathLike,
    payload: Any,
    *,
    encoder=None,
    validator: JsonValidator | None = None,
    create_backup: bool = True,
) -> None:
    """写入、校验后原子替换 JSON，并保留最后一个有效旧版本。"""
    json_path = Path(path)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    lock = _path_lock(json_path)

    with lock:
        temp_path = _temporary_path(json_path)
        backup_path = json_path.with_name(json_path.name + ".bak")
        try:
            _write_json_file(temp_path, payload, encoder)
            read_json(temp_path, validator)

            if create_backup and json_path.exists():
                try:
                    _replace_backup(json_path, backup_path, validator)
                except JsonStoreError:
                    # 当前正式文件已损坏时，保留既有 .bak，不让坏文件覆盖它。
                    pass

            os.replace(temp_path, json_path)
        except (OSError, TypeError, ValueError, JsonStoreError) as exc:
            raise JsonStoreError(f"无法保存 JSON 文件 {json_path.name}: {exc}") from exc
        finally:
            temp_path.unlink(missing_ok=True)


def update_json(
    path: str | os.PathLike,
    updater: Callable[[dict], None],
    *,
    default: dict | None = None,
    validator: JsonValidator | None = None,
) -> dict:
    """在同一个进程锁内完成 JSON 的读取、修改和原子写入。"""
    json_path = Path(path)
    lock = _path_lock(json_path)
    with lock:
        if json_path.exists():
            data = read_json_with_backup(json_path, validator=validator)
            if not isinstance(data, dict):
                raise JsonValidationError(f"{json_path.name} 的根节点必须是对象")
        else:
            data = dict(default or {})
        updater(data)
        atomic_write_json(json_path, data, validator=validator)
        return data


def create_snapshot(
    source: str | os.PathLike,
    backup_dir: str | os.PathLike,
    *,
    prefix: str = "project",
    keep: int = 5,
    validator: JsonValidator | None = None,
) -> Path | None:
    """为有效 JSON 创建时间戳快照，并只保留最近 keep 份。"""
    source_path = Path(source)
    if not source_path.exists():
        return None

    read_json(source_path, validator)
    target_dir = Path(backup_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    target = target_dir / f"{prefix}-{stamp}.json"
    temp_target = _temporary_path(target, "snapshot")
    try:
        shutil.copy2(source_path, temp_target)
        read_json(temp_target, validator)
        os.replace(temp_target, target)
    except (OSError, JsonStoreError) as exc:
        raise JsonStoreError(f"无法创建 JSON 备份 {target.name}: {exc}") from exc
    finally:
        temp_target.unlink(missing_ok=True)

    snapshots = sorted(
        target_dir.glob(f"{prefix}-[0-9]*.json"),
        key=lambda item: item.name,
        reverse=True,
    )
    for old_snapshot in snapshots[max(keep, 0):]:
        old_snapshot.unlink(missing_ok=True)
    return target


def preserve_corrupt_file(
    source: str | os.PathLike,
    backup_dir: str | os.PathLike,
    *,
    prefix: str = "project-corrupt",
) -> Path | None:
    """复制损坏文件作为恢复现场；不对其进行 JSON 解析。"""
    source_path = Path(source)
    if not source_path.exists():
        return None

    target_dir = Path(backup_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    target = target_dir / f"{prefix}-{stamp}.json"
    temp_target = _temporary_path(target, "corrupt")
    try:
        shutil.copy2(source_path, temp_target)
        os.replace(temp_target, target)
        return target
    except OSError as exc:
        raise JsonStoreError(f"无法保留损坏文件 {source_path.name}: {exc}") from exc
    finally:
        temp_target.unlink(missing_ok=True)


def cleanup_temporary_files(directory: str | os.PathLike, filename: str) -> None:
    """清理由本模块遗留的指定文件临时副本。"""
    folder = Path(directory)
    if not folder.exists():
        return
    for candidate in folder.glob(f".{filename}.*.tmp"):
        candidate.unlink(missing_ok=True)
