---
name: SCP:SL 大二维码管理器
description: 面向夜间值班的举报证据工作台
colors:
  page: "#12191b"
  panel: "#192326"
  well: "#141d20"
  raised: "#243235"
  line: "#344447"
  ink: "#edf4f2"
  muted: "#a5b9b9"
  soft: "#83a09f"
  accent: "#a7edcf"
  accent-ink: "#122720"
  success: "#99e4bf"
  warning: "#f4cf91"
  danger: "#ffaaa3"
typography:
  display:
    fontFamily: "system-ui, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "2.55rem"
    fontWeight: 760
    lineHeight: 1.18
    letterSpacing: "-.034em"
  body:
    fontFamily: "system-ui, Microsoft YaHei, PingFang SC, sans-serif"
    fontSize: "15px"
    lineHeight: 1.55
  data:
    fontFamily: "ui-monospace, Cascadia Mono, Consolas, monospace"
rounded:
  control: "8px"
  panel: "15px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "40px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
---

# SCP:SL 大二维码管理器

## Overview

夜班证据工作台。导入区和核验报告共享主列，查询记录独立成侧栏。

## Colors

低亮度青黑分隔页面、面板和输入区。薄荷绿用于主操作和键盘焦点。通过、过期和异常均配有明文状态。

## Typography

界面文字使用系统无衬线。等宽字体用于账号、签名字段、指纹和原始数据。

## Layout

桌面先操作再读报告，侧栏供随时查找历史。手机采用单列，扫码后定位到核验报告。

## Elevation & Depth

用明度和一像素描边区分层级。

## Components

核验报告并列显示签名真实性和进服认证时效。完整字段、核验依据和原始数据在同一报告内切换。
