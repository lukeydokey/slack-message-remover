import { useEffect, useMemo, useState } from 'react'
import { buildCleanupPlan, canStartDeletion } from '../domain/cleanupPlan'
import type { ConnectionStatus, DeleteProgress, DeleteResult, ScanResult, SlackConversation } from '../types'

const twoDigits = (value: number): string => String(value).padStart(2, '0')
const toInputDateTime = (date: Date): string => (
  `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}T${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
)
const now = new Date()
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

function formatConversationKind(kind: SlackConversation['kind']): string {
  if (kind === 'dm') return 'DM'
  if (kind === 'group_dm') return '그룹 DM'
  if (kind === 'private_channel') return '비공개'
  return '공개'
}

function formatSlackTs(ts: string): string {
  return new Date(Number(ts.split('.')[0]) * 1000).toLocaleString()
}

function toIsoDateTime(value: string): string | undefined {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

export function App() {
  const [status, setStatus] = useState<ConnectionStatus>({ connected: false })
  const [clientId, setClientId] = useState('')
  const [conversations, setConversations] = useState<SlackConversation[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [start, setStart] = useState(toInputDateTime(yesterday))
  const [end, setEnd] = useState(toInputDateTime(now))
  const [includeThreads, setIncludeThreads] = useState(false)
  const [scan, setScan] = useState<ScanResult>()
  const [acknowledged, setAcknowledged] = useState(false)
  const [typedCount, setTypedCount] = useState('')
  const [notice, setNotice] = useState('')
  const [deleteResult, setDeleteResult] = useState<DeleteResult>()
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgress>()
  const [isDeleting, setIsDeleting] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.slackCleanup.getStatus().then(setStatus).catch(showError)
  }, [])

  useEffect(() => window.slackCleanup.onDeleteProgress(setDeleteProgress), [])

  const selectedConversations = useMemo(
    () => conversations.filter((conversation) => selectedIds.includes(conversation.id)),
    [conversations, selectedIds]
  )

  const plan = useMemo(() => {
    if (!scan || !status.userId) return undefined
    const startIso = toIsoDateTime(start)
    const endIso = toIsoDateTime(end)
    if (!startIso || !endIso) return undefined
    return buildCleanupPlan({
      connectedUserId: status.userId,
      range: { start: startIso, end: endIso },
      includeThreadReplies: includeThreads,
      messages: scan.messages
    })
  }, [scan, status.userId, start, end, includeThreads])

  function showError(error: unknown): void {
    setNotice(error instanceof Error ? error.message : '작업을 완료하지 못했습니다.')
  }

  async function connect(): Promise<void> {
    setBusy(true)
    setNotice('브라우저에서 Slack 승인을 완료해 주세요.')
    try {
      setStatus(await window.slackCleanup.connect(clientId))
      setNotice('Slack 계정이 연결되었습니다.')
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  async function disconnect(): Promise<void> {
    setBusy(true)
    try {
      await window.slackCleanup.disconnect()
      setStatus({ connected: false })
      setConversations([])
      setSelectedIds([])
      setScan(undefined)
      setDeleteResult(undefined)
      setDeleteProgress(undefined)
      setNotice('Slack 연결을 해제했습니다.')
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  async function loadConversations(): Promise<void> {
    setBusy(true)
    setDeleteResult(undefined)
    setDeleteProgress(undefined)
    try {
      const items = await window.slackCleanup.listConversations()
      setConversations(items)
      setNotice(`${items.length}개의 대화를 불러왔습니다.`)
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  async function preview(): Promise<void> {
    if (selectedIds.length === 0) {
      setNotice('최소 1개의 채널 또는 DM을 선택해 주세요.')
      return
    }
    const startIso = toIsoDateTime(start)
    const endIso = toIsoDateTime(end)
    if (!startIso || !endIso || new Date(startIso) >= new Date(endIso)) {
      setNotice('날짜 범위를 다시 확인해 주세요.')
      return
    }

    setBusy(true)
    setAcknowledged(false)
    setTypedCount('')
    setDeleteResult(undefined)
    setDeleteProgress(undefined)
    try {
      setScan(await window.slackCleanup.scan({
        channelIds: selectedIds,
        start: startIso,
        end: endIso,
        includeThreadReplies: includeThreads
      }))
      setNotice('삭제하지 않고 미리보기만 생성했습니다.')
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  async function deleteCandidates(): Promise<void> {
    if (!scan || !plan || !canStartDeletion({ candidateCount: plan.candidates.length, acknowledgement: acknowledged, typedCount })) return

    setBusy(true)
    setIsDeleting(true)
    setDeleteProgress({ processed: 0, total: plan.candidates.length, deleted: 0, failed: 0, stopped: false })
    try {
      const result = await window.slackCleanup.deleteMessages({
        scanId: scan.scanId,
        messages: [...plan.candidates],
        confirmedCount: plan.candidates.length
      })
      setDeleteResult(result)
      setNotice(`${result.deleted}개 삭제 완료, ${result.failed}개 실패`)
      setScan(undefined)
      setAcknowledged(false)
      setTypedCount('')
    } catch (error) {
      showError(error)
    } finally {
      setIsDeleting(false)
      setBusy(false)
    }
  }

  async function cancelDelete(): Promise<void> {
    try {
      await window.slackCleanup.cancelDelete()
      setNotice('삭제 중단을 요청했습니다. 진행 중인 Slack 요청이 끝나면 멈춥니다.')
    } catch (error) {
      showError(error)
    }
  }

  function toggleConversation(id: string): void {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])
    setScan(undefined)
    setDeleteResult(undefined)
    setDeleteProgress(undefined)
  }

  if (!status.connected) {
    return (
      <main className="shell">
        <header>
          <span className="mark">S</span>
          <div>
            <h1>Slack 메시지 정리</h1>
            <p>사내용 Windows 앱</p>
          </div>
        </header>

        <section className="panel welcome">
          <h2>Slack 연결</h2>
          <p>관리자가 제공한 Slack 앱 Client ID를 입력하면 브라우저에서 승인이 진행됩니다.</p>
          <label>
            Slack App Client ID
            <input
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="예: 123456789.123456789"
            />
          </label>
          <button onClick={() => void connect()} disabled={busy || !clientId.trim()}>Slack 연결</button>
          {notice && <p role="status" className="notice">{notice}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="shell">
      <header>
        <span className="mark">S</span>
        <div>
          <h1>Slack 메시지 정리</h1>
          <p>{status.teamName} · {status.userName} 계정</p>
        </div>
        <button className="quiet" onClick={() => void disconnect()} disabled={busy}>연결 해제</button>
      </header>

      <section className="panel">
        <div className="section-head">
          <h2>1. 대화 선택</h2>
          <button className="secondary" onClick={() => void loadConversations()} disabled={busy}>대화 목록 불러오기</button>
        </div>
        {selectedConversations.length > 0 && (
          <p className="selection">{selectedConversations.length}개 선택됨</p>
        )}
        <div className="conversation-list">
          {conversations.map((conversation) => (
            <label key={conversation.id} className="conversation">
              <input
                type="checkbox"
                checked={selectedIds.includes(conversation.id)}
                onChange={() => toggleConversation(conversation.id)}
              />
              <span className="kind">{formatConversationKind(conversation.kind)}</span>
              <span>{conversation.kind === 'public_channel' || conversation.kind === 'private_channel' ? `#${conversation.name}` : conversation.name}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>2. 기간 설정</h2>
        <div className="fields">
          <label>
            시작 시각
            <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label>
            종료 시각
            <input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={includeThreads} onChange={(event) => setIncludeThreads(event.target.checked)} />
          스레드 답글 포함
        </label>
        <button onClick={() => void preview()} disabled={busy}>삭제 대상 미리보기</button>
      </section>

      {plan && (
        <section className="panel danger">
          <h2>3. 최종 확인</h2>
          <p><strong>{plan.candidates.length}개</strong>의 본인 메시지가 삭제 대상입니다. 이 작업은 되돌릴 수 없습니다.</p>
          {scan?.inaccessibleChannelIds.length ? (
            <p className="warning">{scan.inaccessibleChannelIds.length}개의 대화는 권한 문제로 제외되었습니다.</p>
          ) : null}
          <ul className="preview-list">
            {plan.candidates.slice(0, 5).map((message) => (
              <li key={`${message.channelId}:${message.ts}`}>
                <span>{formatSlackTs(message.ts)}</span>
                <span>{message.text || '(내용 없음)'}</span>
              </li>
            ))}
          </ul>
          {plan.candidates.length > 5 && <p className="hint">개인정보 노출을 줄이기 위해 처음 5개만 표시합니다.</p>}
          <label className="check">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            선택한 범위의 메시지를 영구 삭제한다는 점을 이해했습니다.
          </label>
          <label>
            삭제할 개수 입력: {plan.candidates.length}
            <input inputMode="numeric" value={typedCount} onChange={(event) => setTypedCount(event.target.value)} />
          </label>
          <button
            className="delete"
            onClick={() => void deleteCandidates()}
            disabled={busy || !canStartDeletion({ candidateCount: plan.candidates.length, acknowledgement: acknowledged, typedCount })}
          >
            메시지 {plan.candidates.length}개 삭제
          </button>
          {isDeleting && deleteProgress && (
            <div className="progress" role="status">
              <progress value={deleteProgress.processed} max={deleteProgress.total} />
              <span>
                {deleteProgress.processed}/{deleteProgress.total} 처리됨 · 삭제 {deleteProgress.deleted} · 실패 {deleteProgress.failed}
              </span>
              <button className="secondary" onClick={() => void cancelDelete()}>중단</button>
            </div>
          )}
        </section>
      )}

      {deleteResult && deleteResult.failures.length > 0 && (
        <section className="panel">
          <h2>실패 항목</h2>
          <ul className="preview-list">
            {deleteResult.failures.slice(0, 20).map((failure) => (
              <li key={failure.ts}>
                <span>{failure.ts}</span>
                <span>{failure.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notice && <p role="status" className="notice floating">{notice}</p>}
    </main>
  )
}
