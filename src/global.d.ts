declare global {
  interface Window {
    api: {
      auth: {
        status(): Promise<{ user: any; userCount: number; defaultPassword: boolean }>
        login(p: { username: string; password: string }): Promise<any>
        logout(): Promise<boolean>
        list(): Promise<any[]>
        addUser(p: any): Promise<any>
        setActive(p: any): Promise<boolean>
        setRole(p: any): Promise<boolean>
        changePassword(p: any): Promise<boolean>
        resetPassword(p: any): Promise<boolean>
        removeUser(p: any): Promise<boolean>
        permissions(): Promise<Record<string, boolean> & { role: string | null }>
      }
      company: { read(): Promise<any>; save(p: any): Promise<any> }
      settings: { all(): Promise<Record<string, string>>; set(p: any): Promise<boolean> }

      itemType: { list(): Promise<any[]>; save(p: any): Promise<any>; remove(p: any): Promise<any> }
      itemGroup: { list(): Promise<any[]>; save(p: any): Promise<any>; remove(p: any): Promise<any> }
      design: { list(): Promise<any[]>; save(p: any): Promise<any>; remove(p: any): Promise<any> }
      item: { page(p?: any): Promise<any>; list(p?: any): Promise<any[]>; save(p: any): Promise<any>; remove(p: any): Promise<any> }
      rateMaster: {
        list(p?: any): Promise<any[]>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
        resolve(p: any): Promise<any>
      }
      gridPref: {
        read(p: any): Promise<any[]>
        save(p: any): Promise<any>
        reset(p: any): Promise<any>
        all(): Promise<any[]>
      }
      branch: {
        list(): Promise<any[]>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
        stock(): Promise<any[]>
      }
      stockTransfer: {
        list(p?: any): Promise<any[]>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
      }

      tagStock: {
        page(p?: any): Promise<any>
        facets(keys?: string[]): Promise<Record<string, string[]>>
        list(p?: any): Promise<any[]>
        nextTag(p: any): Promise<string>
        saveBatch(p: any): Promise<any>
        updateRows(p: any): Promise<any>
        remove(p: any): Promise<any>
        findByTag(p: any): Promise<any>
        search(p: any): Promise<any[]>
        searchPaged(p: any): Promise<any>
        exact(p: any): Promise<any[]>
        markPrinted(p: any): Promise<any>
        clearPrinted(p: any): Promise<any>
      }
      looseStock: {
        summary(p?: any): Promise<any>
        ledger(p?: any): Promise<any[]>
        convert(p: any): Promise<any>
        opening(p: any): Promise<any>
        openingBalances(): Promise<any[]>
      }
      looseItem: {
        balances(p?: any): Promise<any[]>
        ledger(p: any): Promise<any[]>
        opening(p: any): Promise<any>
        adjust(p: any): Promise<any>
      }
      party: {
        list(p?: any): Promise<any[]>
        read(p: any): Promise<any>
        balance(p: any): Promise<{ balance: number }>
        metalBalance(p: any): Promise<{ balance: number; metal: string }>
        loyaltyBalance(p: any): Promise<{ balance: number; enabled: boolean }>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
      }
      account: { list(): Promise<any[]>; save(p: any): Promise<any>; nextCode(): Promise<string> }
      series: { list(p?: any): Promise<any[]>; peek(p: any): Promise<string>; save(p: any): Promise<any> }

      sale: {
        list(p?: any): Promise<any[]>
        page(p?: any): Promise<any>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
        forPrint(p: any): Promise<any>
      }
      urd: {
        list(p?: any): Promise<any[]>
        page(p?: any): Promise<any>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
        forPrint(p: any): Promise<any>
      }
      purchase: {
        list(p?: any): Promise<any[]>
        page(p?: any): Promise<any>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
        tally(p: any): Promise<any>
        openForTagging(p?: any): Promise<any[]>
      }
      refinery: {
        list(p?: any): Promise<any[]>
        page(p?: any): Promise<any>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
      }
      order: {
        list(p?: any): Promise<any[]>
        page(p?: any): Promise<any>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        setStatus(p: any): Promise<any>
        remove(p: any): Promise<any>
        toInvoice(p: any): Promise<any>
      }
      voucher: { list(p?: any): Promise<any[]>; page(p?: any): Promise<any>; save(p: any): Promise<any>; remove(p: any): Promise<any> }
      karagir: {
        ledger(p?: any): Promise<any>
        issue(p: any): Promise<any>
        receive(p: any): Promise<any>
        removeIssue(p: any): Promise<any>
        removeReceive(p: any): Promise<any>
      }
      saleReturn: {
        list(p?: any): Promise<any[]>
        page(p?: any): Promise<any>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
      }
      purchaseReturn: {
        list(p?: any): Promise<any[]>
        page(p?: any): Promise<any>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
      }
      stockSettlement: {
        list(p?: any): Promise<any[]>
        page(p?: any): Promise<any>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
      }

      gss: {
        schemes(): Promise<any[]>
        saveScheme(p: any): Promise<any>
        removeScheme(p: any): Promise<any>
        types(): Promise<string[]>
        merge(p: any): Promise<any>
        accounts(p?: any): Promise<any[]>
        readAccount(p: any): Promise<any>
        assign(p: any): Promise<any>
        balance(p: any): Promise<any>
        receive(p: any): Promise<any>
        unreceive(p: any): Promise<any>
        closeAccount(p: any): Promise<any>
        removeAccount(p: any): Promise<any>
      }
      reports: {
        stock(p?: any): Promise<any>
        ledger(p: any): Promise<any>
        metalLedger(p: any): Promise<any>
        accountCumStock(p: any): Promise<any>
        orderTracking(p?: any): Promise<any[]>
        metalOutstanding(p?: any): Promise<any[]>
        dayBook(p: any): Promise<any>
        oldGold(p?: any): Promise<any>
        outstanding(p?: any): Promise<any[]>
        outstandingList(p?: any): Promise<any>
        reorder(): Promise<any[]>
        gstRegister(p: any): Promise<any[]>
        dashboard(): Promise<any>
        dashboardV2(p?: any): Promise<any>
        trialBalance(p?: any): Promise<any>
        profitAndLoss(p?: any): Promise<any>
        balanceSheet(p?: any): Promise<any>
        cashBook(p?: any): Promise<any>
        journal(p?: any): Promise<any>
        register(p?: any): Promise<any>
        gstReturn(p?: any): Promise<any>
        gstSummary(p?: any): Promise<any>
        hsnSummary(p?: any): Promise<any>
        tcsTds(p?: any): Promise<any>
        schemeReport(p?: any): Promise<any>
        mis(p?: any): Promise<any>
        reconcile(p?: any): Promise<any>
      }
      calc: {
        saleTotals(p: any): Promise<any>
        urdTotals(p: any): Promise<any>
        amountInWords(p: any): Promise<string>
      }

      print: {
        html(p: { html: string; silent?: boolean }): Promise<any>
        pdf(p: { html: string; suggestedName?: string }): Promise<any>
      }
      file: { saveText(p: any): Promise<any> }
      backup: {
        create(): Promise<any>
        inspect(): Promise<any>
        restore(p: { filePath: string }): Promise<any>
        current(): Promise<any>
        clearEntries(p: { confirm: string }): Promise<any>
      }
      mobile: {
        status(): Promise<any>
        qr(): Promise<string | null>
        setEnabled(p: { enabled: boolean }): Promise<any>
        setPort(p: { port: number }): Promise<any>
      }
      audit: { list(p?: any): Promise<any> }
      approvals: {
        request(p: any): Promise<any>
        decide(p: any): Promise<any>
        cancel(p: any): Promise<any>
        list(p?: any): Promise<any>
      }
      holds: { place(p: any): Promise<any>; release(p: any): Promise<any>; sweep(): Promise<any> }
      parked: {
        list(p?: any): Promise<any>
        read(p: any): Promise<any>
        park(p: any): Promise<any>
        discard(p: any): Promise<any>
      }
      stockCount: {
        create(p: any): Promise<any>
        read(p: any): Promise<any>
        list(p?: any): Promise<any>
        scan(p: any): Promise<any>
        setStatus(p: any): Promise<any>
        discrepancies(p: any): Promise<any>
      }
      closing: {
        open(p: any): Promise<any>
        read(p: any): Promise<any>
        list(p?: any): Promise<any>
        saveCount(p: any): Promise<any>
        match(p: any): Promise<any>
        submit(p: any): Promise<any>
        approve(p: any): Promise<any>
        reopen(p: any): Promise<any>
      }
      repairs: {
        create(p: any): Promise<any>
        read(p: any): Promise<any>
        list(p?: any): Promise<any>
        transition(p: any): Promise<any>
        addAttachment(p: any): Promise<any>
      }
      reservations: {
        create(p: any): Promise<any>
        set(p: any): Promise<any>
        list(p?: any): Promise<any>
        sweep(): Promise<any>
      }
      memos: { issue(p: any): Promise<any>; close(p: any): Promise<any>; list(p?: any): Promise<any> }
      hallmark: {
        create(p: any): Promise<any>
        read(p: any): Promise<any>
        list(p?: any): Promise<any>
        dispatch(p: any): Promise<any>
        receive(p: any): Promise<any>
      }
      catalogue: {
        categories(p?: any): Promise<any[]>
        saveCategory(p: any): Promise<any>
        saveAlias(p: any): Promise<any>
        aliasSearch(p: any): Promise<any[]>
        previewCsv(p: any): Promise<any>
        commitCsv(p: any): Promise<any>
        mergeItems(p: any): Promise<any>
        unresolved(): Promise<any>
      }
      customer: { summary(p: any): Promise<any> }
      gdrive: {
        status(): Promise<any>
        saveCredentials(p: { clientId: string; clientSecret: string }): Promise<boolean>
        connect(): Promise<{ email: string }>
        disconnect(): Promise<boolean>
        setAutoDaily(p: { enabled: boolean }): Promise<boolean>
        backupNow(): Promise<any>
        listBackups(): Promise<any[]>
        openFolder(): Promise<boolean>
      }
      send: {
        whatsapp(p: { mobile?: string; text: string }): Promise<{ ok: boolean; error?: string }>
        sms(p: { mobile?: string; text: string }): Promise<{ ok: boolean; error?: string }>
        email(p: { email?: string; subject?: string; text: string }): Promise<{ ok: boolean; error?: string }>
      }
      app: { info(): Promise<{ version: string; dataDir: string }> }
    }
  }
}

export {}
