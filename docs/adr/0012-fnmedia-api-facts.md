---
status: accepted
---

# 飞牛影视服务接口的外部事实与约定

记录客户端对接飞牛影视服务（`src/modules/fn_api/`）时，代码类型定义本身看不出的服务端字段约定与外部事实。

## 片头片尾信息（`play/setConfigByItem` 与 `play_config`）

- 写入接口 `/v/api/v1/play/setConfigByItem`（`SetSkipInfoData`）的 `guid` 字段填的是播放项的 `parent_guid`（例如季 GUID），不是播放项本身的 `guid`。
- `skip_opening` 是片头结束的时间点、`skip_ending` 是片尾开始的时间点，单位都是秒。
- `PlayInfo.play_config` 里这两个字段为 `null` 时表示不跳过。

## 字幕与播放项字段

- `PlayInfo.subtitle_guid` 为 `"no_display"` 时表示不显示字幕。
- 时间单位不统一：`ts`、`watched_ts`、`duration`（以及上文的 `skip_opening`、`skip_ending`）以秒计；`PlayInfo.item.runtime` 和 `PlayListItem.runtime` 以分钟计。
- `air_date` 为 `YYYY-MM-DD` 格式字符串。
- 多个布尔含义的字段在接口里用整数 `1` / `0` 表示：`is_favorite`、`is_watched`、`watched`、`can_play` 以及 `ItemListRequest.exclude_folder`。
