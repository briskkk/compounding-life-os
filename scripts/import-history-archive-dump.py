#!/usr/bin/env python3
"""读取 Portfolio.xlsx，把三个 sheet 的流水行以 JSON 打到 stdout。

列：日期 | 进出 | 金额 | 总计 | 备注（表头第 1 行，列名可能带换行单位标注，按位置取）。
行形态：仅总计（估值刷新）/ 进出+金额（现金流，可能同时带总计）/ 空行（跳过）。
输出：{ "sheets": { "<sheet名>": [ {date, direction, amount, total, note}, ... ] } }
仅被 scripts/import-history-archive.ts 调用；只读，不写任何文件。
"""
import datetime
import json
import sys

import openpyxl

SHEETS = ['国内基金', '国内美股', '美元基金']


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(',', '').strip()
    if not s:
        return None
    return float(s)


def main(path: str) -> None:
    wb = openpyxl.load_workbook(path, data_only=True)
    out = {}
    for name in SHEETS:
        ws = wb[name]
        rows = []
        for i, row in enumerate(ws.iter_rows(values_only=True), start=1):
            if i == 1:
                continue  # 表头
            date, direction, amount, total, note = (list(row) + [None] * 5)[:5]
            if date is None and direction is None and amount is None and total is None and note is None:
                continue  # 空行
            if not isinstance(date, datetime.datetime):
                raise SystemExit(f'{name} 第 {i} 行日期缺失或非法: {row!r}')
            direction = str(direction).strip() if direction is not None else None
            if direction is not None and direction not in ('投入', '转出', '转入'):
                raise SystemExit(f'{name} 第 {i} 行进出方向非法: {direction!r}')
            amount = num(amount)
            total = num(total)
            if direction is not None and amount is None:
                raise SystemExit(f'{name} 第 {i} 行有进出方向但金额为空: {row!r}')
            if direction is None and amount is not None:
                raise SystemExit(f'{name} 第 {i} 行有金额但进出方向为空: {row!r}')
            if direction is None and total is None:
                continue  # 只有备注之类的行，跳过
            rows.append({
                'date': date.strftime('%Y-%m-%d'),
                'direction': direction,
                'amount': amount,
                'total': total,
                'note': str(note).strip() if note is not None else None,
            })
        rows.sort(key=lambda r: r['date'])
        out[name] = rows
    json.dump({'sheets': out}, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/Users/hua/Documents/Portfolio.xlsx')
