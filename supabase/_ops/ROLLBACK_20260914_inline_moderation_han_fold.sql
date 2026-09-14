-- Run in an operator transaction. No keyword, rule, grant or policy changes.
CREATE OR REPLACE FUNCTION public.content_moderation_fold_han(raw text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT translate(
    COALESCE(raw, ''),
    '寫購職單結過證辦開發貸網絡賣買錢幣匯換學業專論試題課師導輔賬' ||
    '號聯繫話電機價優團幫們這說對時間為從與個麼沒還會見現兒邊進遠' ||
    '選車門問長頭點級經線給資產貨賺費錄詳諮詢認執駕護簽註冊賠償額' ||
    '銀帳戶兌藥槍賭詐騙廣傳銷補習畢圖書腦碼郵顧譜誠質當無轉歡談讓' ||
    '條應該東華國漢語稱標準節樂醫',
    '写购职单结过证办开发贷网络卖买钱币汇换学业专论试题课师导辅账' ||
    '号联系话电机价优团帮们这说对时间为从与个么没还会见现儿边进远' ||
    '选车门问长头点级经线给资产货赚费录详咨询认执驾护签注册赔偿额' ||
    '银帐户兑药枪赌诈骗广传销补习毕图书脑码邮顾谱诚质当无转欢谈让' ||
    '条应该东华国汉语称标准节乐医'
  );
$$;
NOTIFY pgrst, 'reload schema';
