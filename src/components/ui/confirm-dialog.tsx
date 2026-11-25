"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "确认删除",
  danger = true,
}: {
  open: boolean;
  onClose: () => void;
  /** 返回 false 表示失败（不关闭对话框由调用方自行处理提示） */
  onConfirm: () => Promise<boolean | void>;
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  danger?: boolean;
}) {
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {description && <div className="text-sm text-text-dim">{description}</div>}
      <div className="mt-6 flex gap-3 justify-end">
        <Button variant="ghost" onClick={onClose} disabled={loading}>取消</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={confirm} loading={loading}>
          {confirmText}
        </Button>
      </div>
    </Dialog>
  );
}
