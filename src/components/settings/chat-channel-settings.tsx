"use client"

import { useTranslations } from "next-intl"

import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChannelListTab } from "./channel-list-tab"
import { ChannelCommandsTab } from "./channel-commands-tab"
import { ChannelEventsTab } from "./channel-events-tab"
import { ChannelOtherTab } from "./channel-other-tab"
import { SettingsPageHeader } from "@/components/shared/settings-section"

export function ChatChannelSettings() {
  const t = useTranslations("ChatChannelSettings")

  return (
    <ScrollArea className="h-full">
      <Tabs defaultValue="channels" className="w-full space-y-4 p-3 md:p-4">
        <section className="space-y-3">
          <SettingsPageHeader
            title={t("sectionTitle")}
            description={t("sectionDescription")}
          />
          <TabsList>
            <TabsTrigger value="channels">{t("tabs.channels")}</TabsTrigger>
            <TabsTrigger value="commands">{t("tabs.commands")}</TabsTrigger>
            <TabsTrigger value="events">{t("tabs.events")}</TabsTrigger>
            <TabsTrigger value="other">{t("tabs.other")}</TabsTrigger>
          </TabsList>
        </section>

        <TabsContent value="channels" className="mt-0">
          <ChannelListTab />
        </TabsContent>
        <TabsContent value="commands" className="mt-0">
          <ChannelCommandsTab />
        </TabsContent>
        <TabsContent value="events" className="mt-0">
          <ChannelEventsTab />
        </TabsContent>
        <TabsContent value="other" className="mt-0">
          <ChannelOtherTab />
        </TabsContent>
      </Tabs>
    </ScrollArea>
  )
}
