import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Copy,
  Download,
  File,
  LoaderCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { api } from "./api";
import {
  allowedFilename,
  fileAccept,
  formatBytes,
  type Attachment,
} from "../shared/attachments";
import type { Settings } from "../shared/types";
import "./attachments.css";

export interface AttachmentHandle {
  pick: () => void;
  add: (files: File[]) => void;
}
interface Props {
  id: string;
  exists: boolean;
  settings: Settings;
  disabled: boolean;
  ensureSaved: () => Promise<void>;
  captureAnchor: () => string;
  insert: (file: Attachment, anchor?: string) => Promise<void>;
  onActivity: () => Promise<void>;
}
interface Job {
  key: string;
  file: File;
  status: "queued" | "uploading" | "done" | "failed";
  progress: number;
  error?: string;
  reservation?: string;
  anchor: string;
}

export const Attachments = forwardRef<AttachmentHandle, Props>(
  function Attachments(props, ref) {
    const [files, setFiles] = useState<Attachment[]>([]);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState("");
    const [remove, setRemove] = useState<Attachment | null>(null);
    const [deleting, setDeleting] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const current = useRef(props);
    current.current = props;
    const queue = useRef<Job[]>([]);
    const active = useRef(false);
    const mounted = useRef(true);
    const xhr = useRef<XMLHttpRequest | null>(null);
    const base = `/notes/${props.id}/attachments`;
    const link = (file: Attachment) =>
      new URL(`/api${base}/${file.id}/file`, location.origin).href;
    const refresh = async () => {
      if (!current.current.exists) return;
      const result = await api<{ attachments: Attachment[] }>(base);
      if (mounted.current) {
        setFiles(result.attachments);
        if (result.attachments.length) setOpen(true);
      }
    };
    useEffect(() => {
      mounted.current = true;
      const warn = (e: BeforeUnloadEvent) => {
        if (active.current) {
          e.preventDefault();
          e.returnValue = "";
        }
      };
      window.addEventListener("beforeunload", warn);
      return () => {
        mounted.current = false;
        queue.current = [];
        xhr.current?.abort();
        window.removeEventListener("beforeunload", warn);
      };
    }, []);
    useEffect(() => {
      if (props.exists) void refresh().catch((e) => setMessage(e.message));
    }, [props.exists]);
    const update = (job: Job, patch: Partial<Job>) => {
      Object.assign(job, patch);
      if (mounted.current)
        setJobs((old) => old.map((j) => (j.key === job.key ? { ...job } : j)));
    };
    async function upload(job: Job): Promise<Attachment> {
      const reservation = await api<Attachment>(base, "POST", {
        id: job.reservation || crypto.randomUUID(),
        name: job.file.name,
        size: job.file.size,
      });
      job.reservation = reservation.id;
      if (reservation.state === "ready") return reservation;
      if (reservation.state !== "pending")
        throw new Error("上次上传已进入回收，请重新选择文件。");
      if (!mounted.current) throw new Error("上传已取消。");
      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        xhr.current = request;
        request.open("PUT", `/api${base}/${reservation.id}/content`);
        request.setRequestHeader("Content-Type", "application/octet-stream");
        request.timeout = 300_000;
        request.upload.onprogress = (e) => {
          if (e.lengthComputable)
            update(job, { progress: Math.round((e.loaded / e.total) * 100) });
        };
        request.onload = () => {
          let body;
          try {
            body = JSON.parse(request.responseText);
          } catch {
            reject(new Error("服务器响应异常，请刷新附件列表确认结果。"));
            return;
          }
          if (request.status >= 200 && request.status < 300) resolve(body);
          else reject(new Error(body.error || "上传失败。"));
        };
        request.onerror = () =>
          reject(new Error("网络中断，请重试；上次结果将在重试时核对。"));
        request.ontimeout = () => reject(new Error("上传超时，请重试。"));
        request.onabort = () => reject(new Error("上传已取消。"));
        request.send(job.file);
      });
    }
    async function drain() {
      if (active.current) return;
      active.current = true;
      try {
        while (queue.current.length && mounted.current) {
          const job = queue.current.shift()!;
          update(job, { status: "uploading", progress: 0, error: undefined });
          try {
            if (!current.current.settings.uploadsEnabled)
              throw new Error("管理员已关闭新附件上传。");
            await current.current.ensureSaved();
            if (!mounted.current) break;
            const result = await upload(job);
            if (!mounted.current) break;
            update(job, { status: "done", progress: 100 });
            setFiles((old) => [
              ...old.filter((f) => f.id !== result.id),
              result,
            ]);
            if (result.mime.startsWith("image/")) {
              try {
                await current.current.insert(result, job.anchor);
              } catch (e) {
                setMessage(`图片已上传，${(e as Error).message}`);
              }
            }
            try {
              await current.current.onActivity();
            } catch {
              if (mounted.current)
                setMessage(
                  "附件已上传，笔记到期信息刷新失败，可稍后刷新页面。",
                );
            }
          } catch (e) {
            if (mounted.current)
              update(job, { status: "failed", error: (e as Error).message });
          }
        }
      } finally {
        active.current = false;
        xhr.current = null;
      }
    }
    function add(selected: File[]) {
      if (current.current.disabled) return;
      if (!current.current.settings.uploadsEnabled) {
        setMessage("管理员已关闭新附件上传。");
        setOpen(true);
        return;
      }
      const anchor = current.current.captureAnchor();
      const next: Job[] = selected.slice(0, 100).map((file) => ({
        key: crypto.randomUUID(),
        file,
        status: "queued",
        progress: 0,
        anchor,
      }));
      for (const job of next) {
        if (!allowedFilename(job.file.name) || !job.file.size) {
          job.status = "failed";
          job.error = "文件类型不支持、名称无效或文件为空。";
        } else if (job.file.size > current.current.settings.maxFileBytes) {
          job.status = "failed";
          job.error = "超过单文件大小上限。";
        } else queue.current.push(job);
      }
      setJobs((old) => [...old.filter((j) => j.status !== "done"), ...next]);
      setOpen(true);
      setMessage(
        selected.length > 100
          ? `本次仅添加前 100 个文件，其余 ${selected.length - 100} 个未加入队列。`
          : "",
      );
      void drain();
    }
    useImperativeHandle(ref, () => ({
      pick: () => input.current?.click(),
      add,
    }));
    async function retry(job: Job) {
      if (active.current) return;
      // Resolve a lost successful response before starting a fresh reservation.
      if (job.reservation) {
        try {
          const result = await api<{ attachments: Attachment[] }>(base);
          const found = result.attachments.find(
            (f) => f.id === job.reservation,
          );
          if (found?.state === "ready") {
            setFiles(result.attachments);
            update(job, { status: "done", progress: 100, error: undefined });
            if (found.mime.startsWith("image/"))
              await current.current.insert(found, job.anchor);
            await current.current.onActivity();
            return;
          }
          if (found?.state === "pending")
            await api(`${base}/${found.id}`, "DELETE", {});
          if (found)
            setMessage(
              "旧上传预留正在等待回收，仍占用容量。此次重试会新建上传。",
            );
        } catch (e) {
          setMessage((e as Error).message);
          return;
        }
      }
      job.reservation = undefined;
      update(job, { status: "queued", error: undefined });
      queue.current.push(job);
      void drain();
    }
    async function deleteFile() {
      if (!remove || deleting) return;
      setDeleting(true);
      try {
        await api(`${base}/${remove.id}`, "DELETE", {});
        setRemove(null);
        await refresh();
        await current.current.onActivity();
        setMessage(
          "附件已停止访问。正文引用保留；若文件待回收，容量将在实际删除后释放。",
        );
      } catch (e) {
        setMessage((e as Error).message);
      } finally {
        setDeleting(false);
      }
    }
    return (
      <section className="attachments-panel">
        <input
          ref={input}
          className="attachment-input"
          type="file"
          multiple
          accept={fileAccept}
          aria-label="选择附件"
          onChange={(e) => {
            add(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        <div className="attachments-heading">
          <button
            className="button ghost"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            <Paperclip size={16} />
            附件{" "}
            <span>
              {files.filter((f) => f.state === "ready").length} /{" "}
              {props.settings.maxNoteFiles}
            </span>
            <span>{open ? "−" : "+"}</span>
          </button>
          <span className="attachment-limit">
            单个 {formatBytes(props.settings.maxFileBytes)} · 合计{" "}
            {formatBytes(props.settings.maxNoteBytes)}
          </span>
          <button
            className="icon-button"
            aria-label="刷新附件"
            onClick={() => void refresh().catch((e) => setMessage(e.message))}
          >
            <RefreshCw size={15} />
          </button>
          <button
            className="button secondary"
            onClick={() => input.current?.click()}
            disabled={props.disabled || !props.settings.uploadsEnabled}
          >
            <Plus size={14} />
            上传
          </button>
        </div>
        {open && (
          <div className="attachments-body">
            <p className="attachment-help">
              {props.settings.uploadsEnabled
                ? "支持拖拽文件或粘贴截图；上传前会先保存非空正文。离开笔记会取消上传队列。失败预留将在每日清理时回收。"
                : "新上传已关闭，已有附件仍可使用。"}
            </p>
            {message && (
              <p className="attachment-notice" role="status">
                {message}
              </p>
            )}
            {files.map((file) => (
              <div className="attachment-row" key={file.id}>
                <File size={17} />
                <div className="attachment-name">
                  <strong title={file.name}>{file.name}</strong>
                  <small>
                    {formatBytes(file.size)}
                    {file.state !== "ready" &&
                      ` · ${file.state === "pending" ? "上传未完成，占用预留容量" : "等待回收"}`}
                  </small>
                </div>
                {file.state === "ready" && (
                  <div className="attachment-actions">
                    <a
                      className="icon-button"
                      aria-label={`下载 ${file.name}`}
                      href={`${link(file)}?download=1`}
                    >
                      <Download size={15} />
                    </a>
                    <button
                      className="icon-button"
                      title="复制完整链接"
                      aria-label={`复制 ${file.name} 链接`}
                      onClick={() =>
                        void navigator.clipboard.writeText(link(file)).then(
                          () => setMessage("附件链接已复制。"),
                          () => setMessage("复制失败，请检查剪贴板权限。"),
                        )
                      }
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      className="button ghost"
                      onClick={() => {
                        const anchor = current.current.captureAnchor();
                        void current.current
                          .insert(file, anchor)
                          .catch((e) => setMessage(e.message));
                      }}
                    >
                      插入正文
                    </button>
                  </div>
                )}
                {file.state !== "deleting" && (
                  <button
                    className="icon-button"
                    title="删除附件"
                    aria-label={`删除 ${file.name}`}
                    onClick={() => setRemove(file)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
            {jobs
              .filter((j) => j.status !== "done")
              .map((job) => (
                <div className="attachment-job" key={job.key}>
                  <div>
                    <span>{job.file.name}</span>
                    <small>
                      {job.status === "uploading"
                        ? `${job.progress}%${job.progress === 100 ? " · 正在确认" : ""}`
                        : job.status === "queued"
                          ? "等待上传"
                          : job.error}
                    </small>
                  </div>
                  {job.status === "uploading" && (
                    <progress max="100" value={job.progress} />
                  )}
                  <div>
                    {job.status === "uploading" ? (
                      <button
                        className="icon-button"
                        title="取消上传"
                        onClick={() => xhr.current?.abort()}
                      >
                        <X size={14} />
                      </button>
                    ) : job.status === "failed" ? (
                      <>
                        <button
                          className="button ghost"
                          onClick={() => void retry(job)}
                        >
                          重试
                        </button>
                        <button
                          className="icon-button"
                          aria-label="移除失败记录"
                          onClick={() =>
                            setJobs((old) =>
                              old.filter((j) => j.key !== job.key),
                            )
                          }
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <LoaderCircle size={14} />
                    )}
                  </div>
                </div>
              ))}
            {!files.length && !jobs.length && (
              <p className="attachment-empty">
                还没有附件。图片上传后会自动插入正文。
              </p>
            )}
          </div>
        )}
        {remove && (
          <div className="modal-backdrop">
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-attachment-title"
            >
              <h2 id="delete-attachment-title">删除附件？</h2>
              <p>
                将删除“{remove.name}
                ”。正文中的引用会保留，但链接将失效；操作不可撤销。
              </p>
              <div className="modal-actions">
                <button
                  className="button secondary"
                  disabled={deleting}
                  onClick={() => setRemove(null)}
                >
                  取消
                </button>
                <button
                  className="button danger"
                  disabled={deleting}
                  aria-busy={deleting}
                  onClick={() => void deleteFile()}
                >
                  确认删除附件
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    );
  },
);
