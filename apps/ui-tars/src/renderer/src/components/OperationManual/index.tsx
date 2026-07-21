/**
 * 操作手册管理面板 - 三层架构UI
 * 
 * 显示已录制的操作手册列表、执行记录、匹配测试等功能
 */

import { useEffect, useState } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Card } from '@renderer/components/ui/card';
import { ScrollArea } from '@renderer/components/ui/scroll-area';
import { Badge } from '@renderer/components/ui/badge';
import {
  BookOpen,
  Play,
  Trash2,
  FileText,
  Layers,
  Search,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

interface OperationManual {
  id: string;
  name: string;
  domain: string;
  keywords: string[];
  steps: { order: number; description: string }[];
  createdAt: number;
  lastExecutedAt: number;
  successCount: number;
  failureCount: number;
  verified: boolean;
  version: number;
}

interface ExecutionRecord {
  id: string;
  domain: string;
  instruction: string;
  executedAt: number;
  totalDuration: number;
  success: boolean;
  operations: { actionType: string; status: string }[];
}

interface TaskDefinition {
  id: string;
  domain: string;
  name: string;
  description: string;
  keywords: string[];
  steps: { id: string; order: number; description: string; actionType: string }[];
}

interface MatchResult {
  matched: boolean;
  confidence: number;
  manual?: OperationManual;
  matchType?: string;
}

const domainLabels: Record<string, string> = {
  zhihu: '知乎',
  word: 'Word',
  wechat: '微信',
};

const domainColors: Record<string, string> = {
  zhihu: 'bg-blue-100 text-blue-800',
  word: 'bg-green-100 text-green-800',
  wechat: 'bg-purple-100 text-purple-800',
};

export function OperationManualPanel() {
  const [activeTab, setActiveTab] = useState<'manuals' | 'tasks' | 'match'>('manuals');
  const [manuals, setManuals] = useState<OperationManual[]>([]);
  const [tasks, setTasks] = useState<TaskDefinition[]>([]);
  const [records, setRecords] = useState<ExecutionRecord[]>([]);
  const [matchInput, setMatchInput] = useState('');
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedManual, setExpandedManual] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [manualsData, tasksData, recordsData] = await Promise.all([
        api.getOperationManuals(),
        api.getTaskDefinitions(),
        api.getExecutionRecords(),
      ]);
      setManuals(manualsData || []);
      setTasks(tasksData || []);
      setRecords(recordsData || []);
    } catch (err) {
      console.error('加载操作手册数据失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    await api.deleteOperationManual({ id });
    await loadData();
  };

  const handleMatch = async () => {
    if (!matchInput.trim()) return;
    const result = await api.matchInstruction({ instruction: matchInput.trim() });
    setMatchResult(result as MatchResult);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  };

  const getDomainStats = () => {
    const stats: Record<string, { manuals: number; executions: number; successRate: number }> = {};
    for (const m of manuals) {
      if (!stats[m.domain]) stats[m.domain] = { manuals: 0, executions: 0, successRate: 0 };
      stats[m.domain].manuals++;
    }
    const domainExecs: Record<string, { success: number; total: number }> = {};
    for (const r of records) {
      if (!domainExecs[r.domain]) domainExecs[r.domain] = { success: 0, total: 0 };
      domainExecs[r.domain].total++;
      if (r.success) domainExecs[r.domain].success++;
    }
    for (const [domain, exec] of Object.entries(domainExecs)) {
      if (stats[domain]) {
        stats[domain].executions = exec.total;
        stats[domain].successRate = exec.total > 0 ? Math.round((exec.success / exec.total) * 100) : 0;
      }
    }
    return stats;
  };

  const renderLayerArchitecture = () => (
    <div className="mb-4 p-3 bg-gradient-to-r from-blue-50 via-purple-50 to-green-50 rounded-lg border">
      <h3 className="text-sm font-semibold flex items-center gap-1 mb-2">
        <Layers className="h-4 w-4" />
        三层架构运行状态
      </h3>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-blue-100 p-2 rounded">
          <div className="font-medium text-blue-700">🧠 认知层</div>
          <div className="text-blue-600">视觉多模态</div>
          {manuals.length === 0 && (
            <Badge variant="outline" className="mt-1 bg-blue-50">活跃中</Badge>
          )}
        </div>
        <div className="bg-purple-100 p-2 rounded">
          <div className="font-medium text-purple-700">💾 记忆层</div>
          <div className="text-purple-600">{manuals.length} 个手册</div>
          {manuals.length > 0 && (
            <Badge variant="outline" className="mt-1 bg-purple-50">已就绪</Badge>
          )}
        </div>
        <div className="bg-green-100 p-2 rounded">
          <div className="font-medium text-green-700">⚡ 进化层</div>
          <div className="text-green-600">
            {manuals.filter(m => m.verified).length} 个可回放
          </div>
          {manuals.filter(m => m.verified).length > 0 && (
            <Badge variant="outline" className="mt-1 bg-green-50">就绪</Badge>
          )}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-gray-500">
        {Object.entries(getDomainStats()).map(([domain, stats]) => (
          <div key={domain} className="flex items-center gap-1">
            <span className={`px-1.5 py-0.5 rounded ${domainColors[domain] || ''}`}>
              {domainLabels[domain] || domain}
            </span>
            <span>手册:{stats.manuals}</span>
            <span>执行:{stats.executions}</span>
            {stats.successRate > 0 && <span>成功率:{stats.successRate}%</span>}
          </div>
        ))}
      </div>
    </div>
  );

  const renderManuals = () => (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <BookOpen className="h-4 w-4" />
          操作手册 ({manuals.length})
        </h3>
        <Button size="sm" variant="outline" onClick={loadData} disabled={loading}>
          刷新
        </Button>
      </div>

      {manuals.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">暂无操作手册</p>
          <p className="text-xs text-gray-400 mt-1">
            运行一次Agent任务后，系统将自动记忆操作生成手册
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {manuals.map((manual) => (
            <Card key={manual.id} className="p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${domainColors[manual.domain] || ''}`}>
                      {domainLabels[manual.domain] || manual.domain}
                    </span>
                    <span className="font-medium text-sm">{manual.name}</span>
                    {manual.verified ? (
                      <Badge variant="default" className="bg-green-500 text-xs">已验证</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">未验证</Badge>
                    )}
                    <span className="text-xs text-gray-400">v{manual.version}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span>步骤: {manual.steps.length}</span>
                    <span>成功: {manual.successCount}</span>
                    <span>失败: {manual.failureCount}</span>
                    <span>创建: {formatTime(manual.createdAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {manual.keywords.map((kw) => (
                      <Badge key={kw} variant="secondary" className="text-xs">{kw}</Badge>
                    ))}
                  </div>

                  {/* 展开的步骤详情 */}
                  {expandedManual === manual.id && (
                    <div className="mt-2 pt-2 border-t">
                      <ol className="list-decimal list-inside space-y-1">
                        {manual.steps.sort((a, b) => a.order - b.order).map((step) => (
                          <li key={step.order} className="text-xs text-gray-600">
                            {step.description}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 ml-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setExpandedManual(expandedManual === manual.id ? null : manual.id)}
                    title="查看步骤"
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(manual.id)}
                    title="删除手册"
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  const renderTasks = () => (
    <div>
      <h3 className="text-sm font-semibold flex items-center gap-1 mb-2">
        <FileText className="h-4 w-4" />
        任务定义 ({tasks.length})
      </h3>

      <div className="space-y-2">
        {tasks.map((task) => (
          <Card key={task.id} className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-1.5 py-0.5 rounded text-xs ${domainColors[task.domain] || ''}`}>
                {domainLabels[task.domain] || task.domain}
              </span>
              <span className="font-medium text-sm">{task.name}</span>
            </div>
            <p className="text-xs text-gray-500 mb-1">{task.description}</p>
            <div className="flex flex-wrap gap-1 mb-1">
              {task.keywords.map((kw) => (
                <Badge key={kw} variant="secondary" className="text-xs">{kw}</Badge>
              ))}
            </div>
            <div className="text-xs text-gray-400">
              步骤 ({task.steps.length}):
              <ol className="list-decimal list-inside mt-1">
                {task.steps.sort((a, b) => a.order - b.order).map((step) => (
                  <li key={step.id}>
                    <span className="text-gray-600">{step.description}</span>
                    <span className="text-gray-400 ml-1">({step.actionType})</span>
                  </li>
                ))}
              </ol>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderMatch = () => (
    <div>
      <h3 className="text-sm font-semibold flex items-center gap-1 mb-2">
        <Search className="h-4 w-4" />
        指令匹配测试
      </h3>
      <p className="text-xs text-gray-500 mb-2">
        输入指令测试是否能匹配到已有操作手册。匹配成功则可使用进化层回放模式。
      </p>

      <div className="flex gap-2 mb-3">
        <input
          type="text"
          className="flex-1 px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="输入指令，例如: 打开微信搜索火眼审阅并关注"
          value={matchInput}
          onChange={(e) => setMatchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleMatch()}
        />
        <Button size="sm" onClick={handleMatch}>匹配</Button>
      </div>

      {matchResult && (
        <Card className={`p-3 ${matchResult.matched ? 'bg-green-50' : 'bg-gray-50'}`}>
          <div className="flex items-center gap-2 mb-1">
            {matchResult.matched ? (
              <>
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span className="text-sm font-medium text-green-700">匹配成功</span>
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5 text-gray-400" />
                <span className="text-sm font-medium text-gray-600">未匹配</span>
              </>
            )}
            <span className="text-xs text-gray-400">
              置信度: {Math.round(matchResult.confidence * 100)}%
            </span>
          </div>

          {matchResult.matched && matchResult.manual && (
            <div className="mt-2">
              <div className="flex items-center gap-2 text-sm">
                <span className={`px-1.5 py-0.5 rounded text-xs ${domainColors[matchResult.manual.domain] || ''}`}>
                  {domainLabels[matchResult.manual.domain] || matchResult.manual.domain}
                </span>
                <span className="font-medium">{matchResult.manual.name}</span>
                <Badge variant="outline" className="text-xs">
                  v{matchResult.manual.version}
                </Badge>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                匹配到 {matchResult.manual.steps.length} 步操作，可使用进化层回放。
              </p>
            </div>
          )}

          {!matchResult.matched && (
            <p className="text-xs text-gray-400 mt-1">
              该指令未匹配到现有操作手册，将使用认知层视觉多模态模式执行，并自动记录操作用于后续回放。
            </p>
          )}
        </Card>
      )}

      {/* 最近执行记录 */}
      {records.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-gray-500 mb-2">最近执行记录</h4>
          <div className="space-y-1">
            {records.slice(0, 5).map((record) => (
              <div key={record.id} className="flex items-center gap-2 text-xs text-gray-500 py-1 border-b last:border-b-0">
                {record.success ? (
                  <CheckCircle className="h-3 w-3 text-green-500" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-yellow-500" />
                )}
                <span className={`px-1 rounded text-xs ${domainColors[record.domain] || ''}`}>
                  {domainLabels[record.domain] || record.domain}
                </span>
                <span className="flex-1 truncate">{record.instruction}</span>
                <span>{(record.totalDuration / 1000).toFixed(1)}s</span>
                <span>{formatTime(record.executedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-full">
      {renderLayerArchitecture()}

      <div className="flex gap-1 mb-3 border-b pb-2">
        <button
          className={`px-3 py-1 text-xs rounded-t transition-colors ${
            activeTab === 'manuals'
              ? 'bg-blue-50 text-blue-700 font-medium border-b-2 border-blue-500'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('manuals')}
        >
          操作手册
        </button>
        <button
          className={`px-3 py-1 text-xs rounded-t transition-colors ${
            activeTab === 'tasks'
              ? 'bg-blue-50 text-blue-700 font-medium border-b-2 border-blue-500'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('tasks')}
        >
          任务定义
        </button>
        <button
          className={`px-3 py-1 text-xs rounded-t transition-colors ${
            activeTab === 'match'
              ? 'bg-blue-50 text-blue-700 font-medium border-b-2 border-blue-500'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setActiveTab('match')}
        >
          指令匹配
        </button>
      </div>

      <ScrollArea className="h-[calc(100%-180px)]">
        <div className="pr-2">
          {activeTab === 'manuals' && renderManuals()}
          {activeTab === 'tasks' && renderTasks()}
          {activeTab === 'match' && renderMatch()}
        </div>
      </ScrollArea>
    </div>
  );
}
