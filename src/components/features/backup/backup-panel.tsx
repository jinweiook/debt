"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { validateBackupAction, clearAllDataAction } from "@/server/actions/backup-actions";

interface Preview {
  persons: number;
  accounts: number;
  bills: number;
  repayments: number;
  advances: number;
  exportedAt: string;
}

export function BackupPanel() {
  const { toast } = useToast();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawJson, setRawJson] = useState<unknown>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [importing, setImporting] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearText, setClearText] = useState("");
  const [clearing, setClearing] = useState(false);

  const pickFile = async (file: File) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await validateBackupAction(json);
      if (!res.ok) {
        toast(res.error.message, "error");
        return;
      }
      setRawJson(json);
      setPreview(res.data);
      setConfirmText("");
    } catch {
      toast("文件不是有效的 JSON", "error");
    }
  };

  const doImport = async () => {
    if (confirmText !== "确认") return toast("请输入「确认」二字", "error");
    setImporting(true);
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rawJson),
    });
    const data = await res.json();
    setImporting(false);
    if (data.ok) {
      toast(`导入成功：${data.data.persons} 人 / ${data.data.accounts} 账户 / ${data.data.repayments} 条流水`, "success");
      setPreview(null);
      setRawJson(null);
      router.push("/");
      router.refresh();
    } else {
      toast(data.error ?? "导入失败", "error");
    }
  };

  const doClear = async () => {
    setClearing(true);
    const res = await clearAllDataAction(clearText);
    setClearing(false);
    if (res.ok) {
      toast("已清空全部数据", "success");
      setClearOpen(false);
      setClearText("");
      router.push("/");
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="space-y-3">
        <CardTitle>导出备份</CardTitle>
        <CardDescription>
          下载包含全部欠款人、债务、账单、流水的 JSON 快照。建议定期导出，防止数据丢失。
        </CardDescription>
        <div>
          <a href="/api/export" download>
            <Button>下载备份文件</Button>
          </a>
        </div>
      </Card>

      <Card className="space-y-3">
        <CardTitle>导入备份</CardTitle>
        <CardDescription>
          从 JSON 快照恢复数据。<span className="text-warning">导入将覆盖当前全部数据</span>
          ，建议导入前先导出一份当前快照。
        </CardDescription>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pickFile(f);
            e.target.value = "";
          }}
        />
        <div>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            选择备份文件
          </Button>
        </div>

        {preview && (
          <div className="rounded-[var(--radius-md)] border border-warning/30 bg-warning/8 p-4 space-y-3">
            <p className="text-sm font-medium text-warning">备份内容预览</p>
            <p className="text-sm tnum text-text-dim">
              {preview.persons} 位欠款人 · {preview.accounts} 个债务账户 · {preview.bills} 期账单 ·{" "}
              {preview.repayments} 条还款 · {preview.advances} 条垫付
            </p>
            <p className="text-xs text-text-dim">导出时间：{new Date(preview.exportedAt).toLocaleString("zh-CN")}</p>
            <div className="flex items-center gap-2">
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="输入「确认」二字"
                className="max-w-44"
              />
              <Button variant="danger" onClick={doImport} loading={importing} disabled={confirmText !== "确认"}>
                覆盖导入
              </Button>
              <Button variant="ghost" onClick={() => { setPreview(null); setRawJson(null); }}>
                取消
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="space-y-3 border-danger/25">
        <CardTitle className="text-danger">危险区</CardTitle>
        <CardDescription>清空本地数据库中的全部数据，不可恢复。操作前请务必先导出备份。</CardDescription>
        <div>
          <Button variant="danger" onClick={() => setClearOpen(true)}>清空全部数据</Button>
        </div>
      </Card>

      <Dialog open={clearOpen} onClose={() => setClearOpen(false)} title="确认清空全部数据？">
        <p className="text-sm text-text-dim">
          此操作将删除所有欠款人、债务、账单与流水，<span className="text-danger font-medium">不可恢复</span>。
          请输入「确认清空」以执行。
        </p>
        <Input
          className="mt-4"
          value={clearText}
          onChange={(e) => setClearText(e.target.value)}
          placeholder="确认清空"
        />
        <div className="mt-6 flex gap-3 justify-end">
          <Button variant="ghost" onClick={() => setClearOpen(false)}>取消</Button>
          <Button variant="danger" onClick={doClear} loading={clearing} disabled={clearText !== "确认清空"}>
            永久清空
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
