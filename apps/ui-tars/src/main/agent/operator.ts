/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Key, keyboard } from '@computer-use/nut-js';
import {
  type ScreenshotOutput,
  type ExecuteParams,
  type ExecuteOutput,
} from '@ui-tars/sdk/core';
import { NutJSOperator } from '@ui-tars/operator-nut-js';
import { clipboard, desktopCapturer } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

import * as env from '@main/env';
import { logger } from '@main/logger';
import { sleep } from '@ui-tars/shared/utils';
import { getScreenSize } from '@main/utils/screen';

export class NutJSElectronOperator extends NutJSOperator {
  static MANUAL = {
    ACTION_SPACES: [
      `click(start_box='[x1, y1, x2, y2]')`,
      `left_double(start_box='[x1, y1, x2, y2]')`,
      `right_single(start_box='[x1, y1, x2, y2]')`,
      `drag(start_box='[x1, y1, x2, y2]', end_box='[x3, y3, x4, y4]')`,
      `hotkey(key='')`,
      `type(content='') #If you want to submit your input, use "\\n" at the end of \`content\`.`,
      `scroll(start_box='[x1, y1, x2, y2]', direction='down or up or right or left')`,
      `wait() #Sleep for 5s and take a screenshot to check for any changes.`,
      `run_python(content='''# Python code to execute (e.g., set Word styles). Use win32com for Office automation.''') #Execute Python code to automate Office tasks`,
      `word_document(title='Article title', chapter1='Chapter 1 body...', chapter2='Chapter 2 body...', chapter3='Chapter 3 body...') #Create a Word document with title and 3 chapters, properly styled, saved as docx and exported as PDF`,
      `finished()`,
      `call_user() # Submit the task and call the user when the task is unsolvable, or when you need the user's help.`,
    ],
  };

  public async screenshot(): Promise<ScreenshotOutput> {
    const {
      physicalSize,
      logicalSize,
      scaleFactor,
      id: primaryDisplayId,
    } = getScreenSize(); // Logical = Physical / scaleX

    logger.info(
      '[screenshot] [primaryDisplay]',
      'logicalSize:',
      logicalSize,
      'scaleFactor:',
      scaleFactor,
    );

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(logicalSize.width),
        height: Math.round(logicalSize.height),
      },
    });
    const primarySource =
      sources.find(
        (source) => source.display_id === primaryDisplayId.toString(),
      ) || sources[0];

    if (!primarySource) {
      logger.error('[screenshot] Primary display source not found', {
        primaryDisplayId,
        availableSources: sources.map((s) => s.display_id),
      });
      // fallback to default screenshot
      return await super.screenshot();
    }

    const screenshot = primarySource.thumbnail;

    const resized = screenshot.resize({
      width: physicalSize.width,
      height: physicalSize.height,
    });

    return {
      base64: resized.toJPEG(75).toString('base64'),
      scaleFactor,
    };
  }

  /** 执行Python代码 */
  private async executePythonCode(pythonCode: string): Promise<string> {
    const tmpFile = path.join(
      require('electron').app.getPath('temp'),
      `py_exec_${Date.now()}.py`,
    );
    try {
      fs.writeFileSync(tmpFile, pythonCode, 'utf-8');
      logger.info('[device] executePython: 执行Python脚本');
      const result = execSync(`python "${tmpFile}"`, {
        timeout: 30000,
        encoding: 'utf-8',
      });
      logger.info('[device] executePython 结果:', result);
      return result;
    } catch (err: any) {
      logger.error('[device] executePython 失败:', err.message);
      throw err;
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  async execute(params: ExecuteParams): Promise<ExecuteOutput> {
    const { action_type, action_inputs } = params.parsedPrediction;

    if (action_type === 'type' && env.isWindows && action_inputs?.content) {
      const content = action_inputs.content?.trim();

      // 检测是否以 #!python 开头——如果是则执行Python代码而非打字
      if (content.startsWith('#!python')) {
        const pythonCode = content.replace(/^#!python\s*/, '');
        logger.info('[device] type检测到Python标记，执行脚本');
        try {
          await this.executePythonCode(pythonCode);
          return { status: 'success' as any };
        } catch {
          return { status: 'error' as any };
        }
      }

      logger.info('[device] type', content);
      const stripContent = content.replace(/\\n$/, '').replace(/\n$/, '');
      const originalClipboard = clipboard.readText();
      clipboard.writeText(stripContent);
      await keyboard.pressKey(Key.LeftControl, Key.V);
      await sleep(50);
      await keyboard.releaseKey(Key.LeftControl, Key.V);
      await sleep(50);
      clipboard.writeText(originalClipboard);
    } else if (action_type === 'run_python') {
      const pythonCode = action_inputs?.content as string;
      if (!pythonCode) {
        logger.error('[device] run_python: 没有提供Python代码');
        return { status: 'error' as any };
      }
      try {
        await this.executePythonCode(pythonCode);
      } catch {
        return { status: 'error' as any };
      }
    } else if (action_type === 'word_document') {
      // VLM生成文章内容，Python自动创建完整Word文档
      const ai = action_inputs as Record<string, unknown>;
      const title = (ai?.title as string) || '';
      const chaptersRaw = [
        ai?.chapter1,
        ai?.chapter2,
        ai?.chapter3,
      ].filter((v): v is string => typeof v === 'string');

      if (!title) {
        logger.error('[device] word_document: 缺少title');
        return { status: 'error' as any };
      }

      // 构建Python脚本
      const scriptLines = [
        'import win32com.client as win32',
        'import os',
        '',
        'word = win32.gencache.EnsureDispatch("Word.Application")',
        'word.Visible = True',
        'doc = word.Documents.Add()',
        'sel = word.Selection',
        '',
        `title = ${JSON.stringify(title)}`,
        `chapters = ${JSON.stringify(chaptersRaw)}`,
        '',
        'sel.Style = doc.Styles("标题 1")',
        'sel.Font.Size = 22',
        'sel.Font.Bold = True',
        'sel.TypeText(title)',
        'sel.TypeParagraph()',
        '',
        'for i, chapter in enumerate(chapters):',
        '    lines = chapter.strip().split("\\n", 1)',
        '    chap_title = lines[0].strip() if len(lines) > 0 else f"第{i+1}章"',
        '    chap_body = lines[1].strip() if len(lines) > 1 else chapter',
        '',
        '    sel.Style = doc.Styles("标题 2")',
        '    sel.Font.Size = 16',
        '    sel.Font.Bold = True',
        '    sel.TypeText(chap_title)',
        '    sel.TypeParagraph()',
        '',
        '    sel.Style = doc.Styles("正文")',
        '    sel.Font.Size = 12',
        '    sel.Font.Bold = False',
        '    sel.TypeText(chap_body)',
        '    sel.TypeParagraph()',
        '',
        'for i in range(1, doc.Paragraphs.Count + 1):',
        '    if doc.Paragraphs(i).Range.Style.NameLocal == "标题 2":',
        '        doc.Paragraphs(i).Range.ListFormat.ApplyNumberDefault()',
        '',
        'desktop = os.path.join(os.path.expanduser("~"), "Desktop")',
        'docx_path = os.path.join(desktop, title + ".docx")',
        'doc.SaveAs2(docx_path)',
        'print(f"[Word] 已保存: {docx_path}")',
        '',
        'pdf_path = os.path.join(desktop, title + ".pdf")',
        'doc.ExportAsFixedFormat(pdf_path, 17)',
        'print(f"[Word] 已导出PDF: {pdf_path}")',
        '',
        'doc.Close()',
        'print("[Word] 完成!")',
      ];

      try {
        await this.executePythonCode(scriptLines.join('\n'));
        logger.info(`[device] word_document 完成: ${title}`);
      } catch {
        return { status: 'error' as any };
      }
    } else {
      return await super.execute(params);
    }
  }
}
