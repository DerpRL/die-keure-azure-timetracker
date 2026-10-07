//! Ported from `Tests/AzureTimetrackerCoreTests/CoreTests.swift`: BranchTests, TransactionTests,
//! ActivityChoiceTests and DecodingTests. `DecodingTests.rejectsUnsafeEndpoints` moved to att-net.
//!
//! `git_tests` and `transaction_extras` are new: Swift/ICU parity, the Windows `gitdir` fix, HEAD
//! limits, Swift JSON compatibility and the transaction edge cases the Swift suite left implicit.
//! Two transaction tests come from SlackHuddleTests.swift, whose huddle code is not ported.

#[path = "support/tracking.rs"]
mod support;

/// Swift `BranchTests`.
mod branch_tests {
    use std::fs;

    use att_core::git::{
        BranchChange, BranchDebouncer, BranchPolicy, BranchTicket, BranchTransition,
        DEFAULT_BRANCH_PATTERN, GitProbe, GitSnapshot,
    };
    use att_core::model::Repository;
    use jiff::Timestamp;
    use uuid::Uuid;

    #[test]
    fn integration_branches_suggest_a_break() {
        for branch in [
            "develop",
            "Develop",
            "develop/33984-test",
            "long-feature",
            "long-feature/33984-platform",
            "LONG-FEATURE/33984-platform",
        ] {
            assert!(BranchPolicy::suggests_break(branch), "{branch}");
            assert_eq!(
                BranchTicket::extract(branch, DEFAULT_BRANCH_PATTERN).unwrap(),
                None,
                "{branch}"
            );
            // The policy also takes precedence over custom ticket patterns.
            assert_eq!(BranchTicket::extract(branch, "([0-9]+)").unwrap(), None, "{branch}");
        }
    }

    #[test]
    fn ordinary_ticket_branches_keep_their_suggestions() {
        for branch in [
            "feature/33984-develop",
            "fix/33984-long-feature",
            "development/33984-test",
            "long-feature-fix/33984-test",
        ] {
            assert!(!BranchPolicy::suggests_break(branch), "{branch}");
            assert_eq!(
                BranchTicket::extract(branch, DEFAULT_BRANCH_PATTERN).unwrap(),
                Some(33984),
                "{branch}"
            );
        }
    }

    #[test]
    fn restored_integration_suggestion_ignores_its_previously_extracted_ticket() {
        let change = BranchChange::new(
            &Repository::new("/tmp/repository"),
            "long-feature/33984-platform",
            Some("feature/123-task"),
            Some(33984),
            Timestamp::from_second(1_800_000_000).unwrap(),
        );
        let restored: BranchChange =
            serde_json::from_str(&serde_json::to_string(&change).unwrap()).unwrap();
        assert!(restored.suggests_break());
        assert_eq!(restored.ticket_id, Some(33984));
        assert_eq!(restored, change);
    }

    #[test]
    fn extracts_ticket() {
        for branch in [
            "feature/33624-loading",
            "featute/33624-loading",
            "fix/33624",
            "33624-loading",
            "feature/AB#33624-loading",
        ] {
            assert_eq!(
                BranchTicket::extract(branch, DEFAULT_BRANCH_PATTERN).unwrap(),
                Some(33624),
                "{branch}"
            );
        }
    }

    #[test]
    fn ambiguous_and_non_ticket_branches() {
        for branch in [
            "develop",
            "release/27.0.1",
            "feature/no-ticket",
            "fix/0-no",
            "feature/123-first/456-other",
            "feature/999999999999-too-big",
        ] {
            assert_eq!(
                BranchTicket::extract(branch, DEFAULT_BRANCH_PATTERN).unwrap(),
                None,
                "{branch}"
            );
        }
    }

    #[test]
    fn rejects_pattern_without_group() {
        assert!(BranchTicket::extract("123", "[0-9]+").is_err());
    }

    #[test]
    fn debounces_rapid_checkout() {
        let id = Uuid::new_v4();
        let mut debounce = BranchDebouncer::new();
        let a = GitSnapshot::new(Some("feature/1-a"), "a");
        let b = GitSnapshot::new(Some("feature/2-b"), "b");
        let c = GitSnapshot::new(Some("feature/3-c"), "c");
        assert_eq!(debounce.sample(a.clone(), id), None);
        // Swift only checked `?.old == nil`; the second identical sample commits the baseline.
        assert_eq!(
            debounce.sample(a.clone(), id),
            Some(BranchTransition { old: None, new: a.clone() })
        );
        assert_eq!(debounce.sample(b, id), None);
        assert_eq!(debounce.sample(c.clone(), id), None);
        let change = debounce.sample(c.clone(), id).expect("a second identical sample commits");
        assert_eq!(change.old, Some(a));
        assert_eq!(change.new, c);
        assert_eq!(debounce.sample(c, id), None);
    }

    #[test]
    fn repository_and_relative_worktree() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repository with spaces");
        let git = repo.join(".git");
        let worktree = temp.path().join("worktree");
        fs::create_dir_all(git.join("worktrees/test")).unwrap();
        fs::create_dir_all(&worktree).unwrap();
        fs::write(git.join("HEAD"), "ref: refs/heads/feature/33624-normal\n").unwrap();
        fs::write(worktree.join(".git"), "gitdir: ../repository with spaces/.git/worktrees/test\n")
            .unwrap();
        fs::write(git.join("worktrees/test/HEAD"), "ref: refs/heads/feature/33625-worktree\n")
            .unwrap();
        assert_eq!(GitProbe::read(&repo).unwrap().branch.as_deref(), Some("feature/33624-normal"));
        assert_eq!(
            GitProbe::read(&worktree).unwrap().branch.as_deref(),
            Some("feature/33625-worktree")
        );
        fs::write(
            worktree.join("../repository with spaces/.git/worktrees/test/HEAD"),
            "a".repeat(40),
        )
        .unwrap();
        assert_eq!(GitProbe::read(&worktree).unwrap().branch, None);
    }
}

/// New for 2.0: ICU parity, the Windows `gitdir` fix, HEAD limits and Swift JSON.
mod git_tests {
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::{Path, PathBuf};

    use att_core::git::{
        AUDIT_LIMIT, AuditEntry, BranchChange, BranchDebouncer, BranchPattern, BranchTicket,
        BranchTransition, DEFAULT_BRANCH_PATTERN, GitProbe, GitSnapshot, HEAD_SIZE_LIMIT,
        is_absolute_gitdir, record_audit, resolve_gitdir,
    };
    use att_core::time::secs;
    use jiff::Timestamp;
    use uuid::Uuid;

    /// What the 1.14.2 Swift implementation (NSRegularExpression) returned for the default
    /// pattern; generated by running GitWatcher.swift's `BranchTicket.extract`.
    const SWIFT_DEFAULT_PATTERN_RESULTS: &[(&str, Option<i64>)] = &[
        ("feature/33624-loading", Some(33624)),
        ("featute/33624-loading", Some(33624)),
        ("fix/33624", Some(33624)),
        ("33624-loading", Some(33624)),
        ("feature/AB#33624-loading", Some(33624)),
        ("feature/AB\u{2212}33624-x", Some(33624)),
        ("feature/AB-33624-x", Some(33624)),
        ("feature/ab_33624-x", Some(33624)),
        ("feature/AB33624-x", Some(33624)),
        ("feature/ABC33624-x", None),
        ("feature/33624", Some(33624)),
        ("feature/33624.x", None),
        ("feature/x-33624", None),
        ("feature/x_33624-y", None),
        ("33624", Some(33624)),
        ("/33624", Some(33624)),
        ("feature//33624-x", Some(33624)),
        ("feature/0123-x", None),
        ("feature/123456789-x", Some(123_456_789)),
        ("feature/1234567890-x", None),
        ("feature/2147483647-x", None),
        ("feature/123-a/123-b", Some(123)),
        ("feature/123-a/456-b", None),
        ("hotfix/AB#1_x", Some(1)),
        ("a/1-b/2-c", None),
        ("Feature/ab#77-x", Some(77)),
        ("feature/\u{FF12}\u{FF13}-x", None),
        ("feature/\u{0663}-x", None),
        ("release/2026-10", Some(2026)),
        ("feature/12-34", Some(12)),
        ("users/yarne/33984-x", Some(33984)),
        ("feature/AB#-33624", None),
        ("feature/AB##33624-x", None),
        ("/develop/1-x", None),
        ("develop", None),
        ("Long-Feature/5-x", None),
        ("long-featurex/5-x", Some(5)),
        ("", None),
        ("/", None),
        ("feature/", None),
        ("feature/AB\u{2013}33624-x", None),
        ("feature/\u{00E9}\u{00E9}/42-x", Some(42)),
        ("feature/42-\u{00E9}", Some(42)),
    ];

    /// Swift results for custom patterns: `(pattern, branch, ticket)`.
    const SWIFT_CUSTOM_PATTERN_RESULTS: &[(&str, &str, Option<i64>)] = &[
        (r"([0-9]+)", "feature/12-a/12", Some(12)),
        (r"#(\d+)", "fix #42 and #42", Some(42)),
        (r"(?<id>\d+)", "task-7", Some(7)),
        (r"([0-9]+)|x", "x", None),
        (r"(\d+)-(\d+)", "1-2", Some(1)),
        (r"(ab)", "AB", None),
        (r"(0+)", "000", None),
        (r"([+-]?\d+)", "x+5", Some(5)),
        (r"([+-]?\d+)", "x-5", None),
        (r"(\d+)", "feature/\u{0663}\u{0664}", None),
        (r"(?=(\d+))", "12", None),
        (r"()", "abc", None),
        (r"(\d*)", "a1b", Some(1)),
        (r"(?<=/)(\d+)", "x/9", Some(9)),
        (r"(\d+)$", "feature/x-15", Some(15)),
        (r"^(\d+)", "15-x", Some(15)),
        (r"\b(\d+)\b", "ticket 31 here", Some(31)),
    ];

    #[test]
    fn default_pattern_matches_swift_results() {
        for (branch, expected) in SWIFT_DEFAULT_PATTERN_RESULTS {
            let actual = BranchTicket::extract(branch, DEFAULT_BRANCH_PATTERN).unwrap();
            assert_eq!(actual, *expected, "{branch:?}");
        }
    }

    #[test]
    fn custom_patterns_match_swift_results() {
        for (pattern, branch, expected) in SWIFT_CUSTOM_PATTERN_RESULTS {
            let actual = BranchTicket::extract(branch, pattern).unwrap();
            assert_eq!(actual, *expected, "{pattern} on {branch:?}");
        }
    }

    #[test]
    fn default_pattern_keeps_the_unicode_minus_sign() {
        assert!(DEFAULT_BRANCH_PATTERN.contains('\u{2212}'));
        assert_eq!(
            DEFAULT_BRANCH_PATTERN,
            concat!("(?:^|/)(?:AB[", "\u{2212}", "#_-]?)?([1-9][0-9]{0,8})(?=[_-]|$)")
        );
    }

    #[test]
    fn invalid_patterns_report_the_swift_message_except_on_integration_branches() {
        let error = BranchTicket::extract("feature/1-a", "(abc").unwrap_err();
        assert_eq!(error.to_string(), "The value “(abc” is invalid.");
        // The break policy runs before the pattern is compiled.
        assert_eq!(BranchTicket::extract("develop", "(abc").unwrap(), None);
        let error = BranchTicket::extract("123", "[0-9]+").unwrap_err();
        assert_eq!(
            error.to_string(),
            "The branch pattern needs a capture group for the ticket number, such as ([0-9]+)."
        );
    }

    #[test]
    fn tester_result_texts() {
        let branch = "feature/33624-improve-loading";
        assert_eq!(BranchTicket::tester_result(branch, DEFAULT_BRANCH_PATTERN), "Ticket #33624");
        assert_eq!(
            BranchTicket::tester_result("feature/1-a/2-b", DEFAULT_BRANCH_PATTERN),
            "No unique ticket found"
        );
        assert_eq!(
            BranchTicket::tester_result(branch, "[0-9]+"),
            "Invalid pattern: The branch pattern needs a capture group for the ticket number, such as ([0-9]+)."
        );
    }

    #[test]
    fn pathological_patterns_fail_instead_of_hanging() {
        // Exponential backtracking: the search stops at the backtracking budget.
        let branch = format!("feature/{}!", "a".repeat(30));
        let error = BranchTicket::extract(&branch, r"(a|a)*\1b").unwrap_err();
        assert_eq!(
            error.to_string(),
            "The branch pattern is too complex to check this branch. Simplify the pattern."
        );
    }

    #[test]
    fn compiled_pattern_is_reusable() {
        let pattern = BranchPattern::new(DEFAULT_BRANCH_PATTERN).unwrap();
        assert_eq!(pattern.as_str(), DEFAULT_BRANCH_PATTERN);
        assert_eq!(pattern.extract("feature/33624-x").unwrap(), Some(33624));
        assert_eq!(pattern.extract("develop/33624-x").unwrap(), None);
        assert_eq!(pattern.extract("feature/1-a/2-b").unwrap(), None);
        assert!(BranchPattern::new("[0-9]+").is_err());
    }

    #[test]
    fn gitdir_pointers_with_windows_absolute_paths_are_not_joined_to_the_worktree() {
        let root = Path::new("/Users/me/worktree");
        for absolute in [
            "/Users/me/repo/.git/worktrees/wt",
            "C:/Users/me/repo/.git/worktrees/wt",
            r"C:\Users\me\repo\.git\worktrees\wt",
            r"d:\repo\.git\modules\sub",
            r"\\server\share\repo\.git\worktrees\wt",
            "//server/share/repo/.git/worktrees/wt",
            r"\\?\C:\Users\me\repo\.git\worktrees\wt",
        ] {
            assert!(is_absolute_gitdir(absolute), "{absolute}");
            assert_eq!(resolve_gitdir(root, absolute), PathBuf::from(absolute), "{absolute}");
        }
        for relative in [
            "../repo/.git/worktrees/wt",
            r"..\repo\.git\worktrees\wt",
            ".git/modules/sub",
            "repo",
            "C:relative",
            "C:",
            " /leading-space",
        ] {
            assert!(!is_absolute_gitdir(relative), "{relative}");
            assert_eq!(resolve_gitdir(root, relative), root.join(relative), "{relative}");
        }
    }

    #[test]
    fn absolute_gitdir_pointer_is_followed() {
        let temp = tempfile::tempdir().unwrap();
        let git_dir = temp.path().join("elsewhere/.git/worktrees/wt");
        fs::create_dir_all(&git_dir).unwrap();
        fs::write(git_dir.join("HEAD"), "ref: refs/heads/feature/77-absolute\n").unwrap();
        let worktree = temp.path().join("wt");
        fs::create_dir_all(&worktree).unwrap();
        fs::write(worktree.join(".git"), format!("gitdir: {}\r\n", git_dir.display())).unwrap();
        let snapshot = GitProbe::read(&worktree).unwrap();
        assert_eq!(snapshot.branch.as_deref(), Some("feature/77-absolute"));
        assert_eq!(snapshot.head, "ref: refs/heads/feature/77-absolute");
    }

    #[test]
    fn head_size_encoding_and_format_limits() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path();
        fs::create_dir_all(repo.join(".git")).unwrap();
        let head = repo.join(".git/HEAD");
        let unreadable = "Git HEAD is temporarily unreadable.";

        // Up to 8,191 bytes are read, trailing whitespace included; 8,192 is too large.
        let mut text = "ref: refs/heads/main".to_string();
        text.push_str(&"\n".repeat(HEAD_SIZE_LIMIT - 1 - text.len()));
        fs::write(&head, &text).unwrap();
        assert_eq!(GitProbe::read(repo).unwrap().branch.as_deref(), Some("main"));
        text.push('\n');
        fs::write(&head, &text).unwrap();
        assert_eq!(GitProbe::read(repo).unwrap_err().to_string(), unreadable);

        // Foundation drops a UTF-8 byte-order mark.
        fs::write(&head, "\u{feff}ref: refs/heads/feature/1-bom\n").unwrap();
        assert_eq!(GitProbe::read(repo).unwrap().branch.as_deref(), Some("feature/1-bom"));
        // Swift kept an empty branch name for a bare "ref: refs/heads/".
        fs::write(&head, "ref: refs/heads/\n").unwrap();
        assert_eq!(GitProbe::read(repo).unwrap().branch.as_deref(), Some(""));

        let invalid: [&[u8]; 8] = [
            b"\xff\xfe",
            b"",
            b" \n\t",
            b"ref: refs/remotes/origin/main",
            b"ref: refs/tags/v1",
            &[b'a'; 39],
            &[b'a'; 65],
            b"gggggggggggggggggggggggggggggggggggggggg",
        ];
        for bytes in invalid {
            fs::write(&head, bytes).unwrap();
            assert_eq!(GitProbe::read(repo).unwrap_err().to_string(), unreadable, "{bytes:?}");
        }
        for object_id in ["a".repeat(40), "0123456789ABCDEF".repeat(4)] {
            fs::write(&head, format!("{object_id}\n")).unwrap();
            let snapshot = GitProbe::read(repo).unwrap();
            assert_eq!(snapshot, GitSnapshot::new(None, object_id.clone()));
            assert_eq!(snapshot.label(), "Detached HEAD");
        }
    }

    #[test]
    fn probe_errors_use_the_swift_messages() {
        let temp = tempfile::tempdir().unwrap();
        let plain = temp.path().join("plain");
        fs::create_dir_all(&plain).unwrap();
        let no_repository = "No Git repository at plain. Choose its root folder.";
        assert_eq!(GitProbe::read(&plain).unwrap_err().to_string(), no_repository);
        let with_separator = format!("{}/", plain.display());
        assert_eq!(GitProbe::read(with_separator).unwrap_err().to_string(), no_repository);

        let pointer = temp.path().join("pointer");
        fs::create_dir_all(&pointer).unwrap();
        fs::write(pointer.join(".git"), "gitdir:missing-space").unwrap();
        assert_eq!(
            GitProbe::read(&pointer).unwrap_err().to_string(),
            "Invalid .git file in pointer."
        );
        fs::write(pointer.join(".git"), b"gitdir: \xff").unwrap();
        assert_eq!(
            GitProbe::read(&pointer).unwrap_err().to_string(),
            "The file couldn’t be opened because it isn’t in the correct format."
        );
        let missing_head = "The file “HEAD” couldn’t be opened because there is no such file.";
        fs::write(pointer.join(".git"), "gitdir: missing/.git\n").unwrap();
        assert_eq!(GitProbe::read(&pointer).unwrap_err().to_string(), missing_head);

        let empty = temp.path().join("empty");
        fs::create_dir_all(empty.join(".git")).unwrap();
        assert_eq!(GitProbe::read(&empty).unwrap_err().to_string(), missing_head);

        // A pointer through a regular file: Foundation has no specific reason for this failure
        // (ENOTDIR). Windows reports the path as not found.
        fs::write(temp.path().join("file"), "x").unwrap();
        fs::write(pointer.join(".git"), "gitdir: ../file/.git\n").unwrap();
        let through_a_file =
            if cfg!(windows) { missing_head } else { "The file “HEAD” couldn’t be opened." };
        assert_eq!(GitProbe::read(&pointer).unwrap_err().to_string(), through_a_file);
    }

    /// `state.json` fragments as Swift 1.14.2 wrote them (`JSONEncoder`, pretty-printed, sorted).
    const SWIFT_STATE: &str = r#"{
      "audit" : [
        {
          "date" : 821692800.25,
          "detail" : "Campus → feature\/33630-user-journey",
          "id" : "6F9619FF-8B86-D011-B42D-00C04FC964FF",
          "title" : "Branch changed"
        }
      ],
      "pending" : [
        {
          "branch" : "feature\/33630-user-journey",
          "detectedAt" : 821692900,
          "id" : "E621E1F8-C36C-495A-93FC-0C247A3E6E5F",
          "repositoryID" : "C7B0B9A2-1D7E-4B8F-9E54-3A7D2E8F1B6C",
          "repositoryName" : "Campus",
          "ticketID" : 33630
        },
        {
          "branch" : "develop",
          "detectedAt" : 0,
          "id" : "0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0",
          "previousBranch" : "feature\/33630-user-journey",
          "repositoryID" : "C7B0B9A2-1D7E-4B8F-9E54-3A7D2E8F1B6C",
          "repositoryName" : "Campus"
        }
      ]
    }"#;

    #[test]
    fn branch_changes_decode_swift_json() {
        let state: serde_json::Value = serde_json::from_str(SWIFT_STATE).unwrap();
        let pending: Vec<BranchChange> = serde_json::from_value(state["pending"].clone()).unwrap();
        let repository = Uuid::parse_str("C7B0B9A2-1D7E-4B8F-9E54-3A7D2E8F1B6C").unwrap();
        assert_eq!(
            pending[0],
            BranchChange {
                id: Uuid::parse_str("E621E1F8-C36C-495A-93FC-0C247A3E6E5F").unwrap(),
                repository_id: repository,
                repository_name: "Campus".to_string(),
                branch: "feature/33630-user-journey".to_string(),
                previous_branch: None,
                ticket_id: Some(33630),
                detected_at: Timestamp::from_second(1_800_000_100).unwrap(),
            }
        );
        assert_eq!(pending[1].previous_branch.as_deref(), Some("feature/33630-user-journey"));
        assert_eq!(pending[1].ticket_id, None);
        assert!(pending[1].suggests_break());
        assert_eq!(pending[1].detected_at.to_string(), "2001-01-01T00:00:00Z");

        // Writes use camelCase keys and RFC 3339 dates, and read back unchanged.
        let json = serde_json::to_value(&pending[0]).unwrap();
        assert_eq!(json["repositoryId"], "c7b0b9a2-1d7e-4b8f-9e54-3a7d2e8f1b6c");
        assert_eq!(json["ticketId"], 33630);
        assert_eq!(json["detectedAt"], "2027-01-15T08:01:40Z");
        assert!(json.get("previousBranch").is_none());
        assert_eq!(serde_json::from_value::<BranchChange>(json).unwrap(), pending[0]);
    }

    #[test]
    fn audit_entries_decode_swift_json() {
        let state: serde_json::Value = serde_json::from_str(SWIFT_STATE).unwrap();
        let audit: Vec<AuditEntry> = serde_json::from_value(state["audit"].clone()).unwrap();
        assert_eq!(audit.len(), 1);
        assert_eq!(audit[0].id, Uuid::parse_str("6F9619FF-8B86-D011-B42D-00C04FC964FF").unwrap());
        assert_eq!(audit[0].title, "Branch changed");
        assert_eq!(audit[0].detail, "Campus → feature/33630-user-journey");
        assert!((secs(audit[0].date) - 1_800_000_000.25).abs() < 1e-6);
        let json = serde_json::to_string(&audit[0]).unwrap();
        assert_eq!(serde_json::from_str::<AuditEntry>(&json).unwrap(), audit[0]);
    }

    #[test]
    fn audit_log_keeps_the_newest_2000_entries() {
        let now = Timestamp::from_second(1_800_000_000).unwrap();
        let mut log = Vec::new();
        for index in 0..2005 {
            record_audit(
                &mut log,
                AuditEntry::new("Branch changed", format!("Campus → {index}"), now),
            );
        }
        assert_eq!(log.len(), AUDIT_LIMIT);
        assert_eq!(log[0].detail, "Campus → 2004");
        assert_eq!(log[AUDIT_LIMIT - 1].detail, "Campus → 5");
    }

    #[test]
    fn flicker_back_to_the_committed_branch_cancels_the_candidate() {
        let id = Uuid::new_v4();
        let mut debounce = BranchDebouncer::new();
        let a = GitSnapshot::new(Some("feature/1-a"), "a");
        let b = GitSnapshot::new(Some("feature/2-b"), "b");
        debounce.sample(a.clone(), id);
        debounce.sample(a.clone(), id);
        assert_eq!(debounce.sample(b.clone(), id), None);
        assert_eq!(debounce.sample(a.clone(), id), None);
        // The earlier `b` reading was discarded, so `b` needs two fresh samples again.
        assert_eq!(debounce.sample(b.clone(), id), None);
        assert_eq!(debounce.sample(b.clone(), id), Some(BranchTransition { old: Some(a), new: b }));
    }

    #[test]
    fn debouncer_forgets_unwatched_repositories() {
        let (kept, dropped) = (Uuid::new_v4(), Uuid::new_v4());
        let mut debounce = BranchDebouncer::new();
        let a = GitSnapshot::new(Some("feature/1-a"), "a");
        for id in [kept, dropped] {
            debounce.sample(a.clone(), id);
            debounce.sample(a.clone(), id);
        }
        debounce.retain(&BTreeSet::from([kept]));
        assert_eq!(debounce.sample(a.clone(), kept), None);
        assert_eq!(debounce.sample(a.clone(), dropped), None);
        assert_eq!(
            debounce.sample(a.clone(), dropped),
            Some(BranchTransition { old: None, new: a })
        );
    }
}

/// Swift `TransactionTests`.
mod transaction_tests {
    use att_core::AppError;
    use att_core::tracking::{self, no_context};

    use super::support::{StateSpec, StubTracker, state};

    #[tokio::test]
    async fn switch_stops_then_starts() {
        let old = state(Some(100));
        let stub = StubTracker::new(old.clone(), state(None));
        let result =
            tracking::switch_to(Some(200), &old.identity(), None, None, None, &stub, no_context)
                .await
                .unwrap();
        assert_eq!(result.track.and_then(|track| track.tfs_id), Some(200));
        assert_eq!(stub.calls().await, ["current", "stop", "start:200"]);
    }

    #[tokio::test]
    async fn same_ticket_does_not_restart() {
        let old = state(Some(100));
        let stub = StubTracker::new(old.clone(), state(None));
        tracking::switch_to(Some(100), &old.identity(), None, None, None, &stub, no_context)
            .await
            .unwrap();
        assert_eq!(stub.calls().await, ["current"]);
    }

    #[tokio::test]
    async fn changed_remote_session_prevents_all_writes() {
        let old = StateSpec::new(Some(100)).session("old").build();
        let stub = StubTracker::new(StateSpec::new(Some(100)).session("new").build(), state(None));
        let error =
            tracking::switch_to(Some(200), &old.identity(), None, None, None, &stub, no_context)
                .await
                .unwrap_err();
        assert_eq!(error, AppError::RemoteChanged);
        assert_eq!(stub.calls().await, ["current"]);
    }

    #[tokio::test]
    async fn failed_stop_never_starts() {
        let old = state(Some(100));
        let stub = StubTracker::with_errors(old.clone(), state(None), true, false);
        let error =
            tracking::switch_to(Some(200), &old.identity(), None, None, None, &stub, no_context)
                .await
                .unwrap_err();
        assert_eq!(error, AppError::Timeout);
        assert_eq!(stub.calls().await, ["current", "stop"]);
    }

    #[tokio::test]
    async fn unconfirmed_stop_never_starts() {
        let old = state(Some(100));
        let stub = StubTracker::new(old.clone(), old.clone());
        let error =
            tracking::switch_to(Some(200), &old.identity(), None, None, None, &stub, no_context)
                .await
                .unwrap_err();
        assert_eq!(
            error.to_string(),
            "7pace did not confirm that the current timer stopped. The new timer was not started."
        );
        assert_eq!(stub.calls().await, ["current", "stop"]);
    }

    #[tokio::test]
    async fn timed_out_start_is_not_replayed() {
        let old = state(Some(100));
        let stub = StubTracker::with_errors(old.clone(), state(None), false, true);
        let error =
            tracking::switch_to(Some(200), &old.identity(), None, None, None, &stub, no_context)
                .await
                .unwrap_err();
        assert_eq!(error, AppError::Timeout);
        assert_eq!(stub.calls().await, ["current", "stop", "start:200"]);
    }

    #[tokio::test]
    async fn forbidden_start_does_not_stop_current_timer() {
        let old = StateSpec::new(Some(100)).allowed(false).build();
        let stub = StubTracker::new(old.clone(), state(None));
        let error =
            tracking::switch_to(Some(200), &old.identity(), None, None, None, &stub, no_context)
                .await
                .unwrap_err();
        assert_eq!(
            error.to_string(),
            "7pace does not currently allow starting a timer. Check your tracking settings."
        );
        assert_eq!(stub.calls().await, ["current"]);
    }

    #[tokio::test]
    async fn idle_starts_without_stop() {
        let old = state(None);
        let stub = StubTracker::new(old.clone(), old.clone());
        tracking::switch_to(Some(200), &old.identity(), None, None, None, &stub, no_context)
            .await
            .unwrap();
        assert_eq!(stub.calls().await, ["current", "start:200"]);
    }

    #[tokio::test]
    async fn stop_respects_remote_change() {
        let old = state(Some(100));
        let stub = StubTracker::new(state(Some(200)), state(None));
        let error = tracking::stop(&old.identity(), &stub).await.unwrap_err();
        assert_eq!(error, AppError::RemoteChanged);
        assert_eq!(stub.calls().await, ["current"]);
    }

    #[tokio::test]
    async fn selected_activity_is_used_for_the_new_session() {
        let old = StateSpec::new(Some(100)).activity("development").build();
        let stub = StubTracker::new(old.clone(), state(None));
        let result = tracking::switch_to(
            Some(200),
            &old.identity(),
            Some("testing"),
            None,
            None,
            &stub,
            no_context,
        )
        .await
        .unwrap();
        assert_eq!(stub.started_activities().await, [Some("testing".to_string())]);
        assert_eq!(
            result.track.and_then(|track| track.activity_type_id).as_deref(),
            Some("testing")
        );
    }

    #[tokio::test]
    async fn same_ticket_with_different_activity_starts_a_new_session() {
        let old = StateSpec::new(Some(100)).activity("development").build();
        let stub = StubTracker::new(old.clone(), state(None));
        tracking::switch_to(
            Some(100),
            &old.identity(),
            Some("testing"),
            None,
            None,
            &stub,
            no_context,
        )
        .await
        .unwrap();
        assert_eq!(stub.calls().await, ["current", "stop", "start:100"]);
        assert_eq!(stub.started_activities().await, [Some("testing".to_string())]);
    }

    #[tokio::test]
    async fn same_ticket_and_activity_keeps_current_session() {
        let old = StateSpec::new(Some(100)).activity("development").build();
        let stub = StubTracker::new(old.clone(), state(None));
        tracking::switch_to(
            Some(100),
            &old.identity(),
            Some("development"),
            None,
            None,
            &stub,
            no_context,
        )
        .await
        .unwrap();
        assert_eq!(stub.calls().await, ["current"]);
    }
}

/// From SlackHuddleTests.swift (live tracking code in a dead file) and new edge cases.
mod transaction_extras {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use async_trait::async_trait;
    use att_core::model::{TrackingState, WireValue};
    use att_core::service::TrackingService;
    use att_core::tracking::{self, no_context};
    use att_core::{AppError, Result};
    use tokio::sync::Mutex;

    use super::support::{StateSpec, StubTracker, state};

    /// SlackHuddleTests `noTicketTrackingPreservesExactActivityAndComment`.
    #[tokio::test]
    async fn no_ticket_tracking_preserves_exact_activity_and_comment() {
        let old = state(Some(123));
        let stub = StubTracker::new(old.clone(), state(None));
        let started = tracking::switch_to(
            None,
            &old.identity(),
            Some("standup"),
            Some("daily standup"),
            None,
            &stub,
            no_context,
        )
        .await
        .unwrap();
        assert!(started.running());
        let track = started.track.unwrap();
        assert_eq!(track.ticket_id(), None);
        assert_eq!(track.activity_type_id.as_deref(), Some("standup"));
        assert_eq!(track.remark.as_deref(), Some("daily standup"));
        assert_eq!(stub.calls().await, ["current", "stop", "start:unassigned"]);
    }

    /// SlackHuddleTests `emptyUnassignedTrackingIsRejectedBeforeNetwork`.
    #[tokio::test]
    async fn empty_unassigned_tracking_is_rejected_before_network() {
        let old = state(None);
        let stub = StubTracker::new(old.clone(), old.clone());
        let error = tracking::switch_to(
            None,
            &old.identity(),
            Some("standup"),
            None,
            None,
            &stub,
            no_context,
        )
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), "Choose a valid ticket or supply a tracking comment.");
        assert!(stub.calls().await.is_empty());
    }

    #[tokio::test]
    async fn invalid_tickets_and_blank_comments_are_rejected_before_network() {
        let old = state(None);
        let stub = StubTracker::new(old.clone(), old.clone());
        let too_large = i64::from(i32::MAX) + 1;
        for (ticket, remark) in
            [(Some(0), None), (Some(-5), Some("x")), (Some(too_large), None), (None, Some(" \n"))]
        {
            let error =
                tracking::switch_to(ticket, &old.identity(), None, remark, None, &stub, no_context)
                    .await
                    .unwrap_err();
            assert_eq!(
                error.to_string(),
                "Choose a valid ticket or supply a tracking comment.",
                "{ticket:?} {remark:?}"
            );
        }
        assert!(stub.calls().await.is_empty());
        let largest = i64::from(i32::MAX);
        tracking::switch_to(Some(largest), &old.identity(), None, None, None, &stub, no_context)
            .await
            .unwrap();
        assert_eq!(stub.calls().await, ["current", format!("start:{largest}").as_str()]);
    }

    #[tokio::test]
    async fn same_ticket_free_comment_keeps_current_session() {
        let old = state(None);
        let stub = StubTracker::new(old.clone(), old.clone());
        let running = tracking::switch_to(
            None,
            "idle",
            Some("standup"),
            Some("daily standup"),
            None,
            &stub,
            no_context,
        )
        .await
        .unwrap();
        let stub = StubTracker::new(running.clone(), state(None));
        let kept = tracking::switch_to(
            None,
            &running.identity(),
            Some("standup"),
            Some("daily standup"),
            None,
            &stub,
            no_context,
        )
        .await
        .unwrap();
        assert_eq!(kept, running);
        assert_eq!(stub.calls().await, ["current"]);
        // A different comment is a new session.
        tracking::switch_to(
            None,
            &running.identity(),
            None,
            Some("Retro"),
            None,
            &stub,
            no_context,
        )
        .await
        .unwrap();
        assert_eq!(stub.calls().await, ["current", "current", "stop", "start:unassigned"]);
    }

    #[tokio::test]
    async fn outdated_context_before_any_write_prevents_all_writes() {
        let old = state(Some(100));
        let stub = StubTracker::new(old.clone(), state(None));
        let error =
            tracking::switch_to(Some(42), &old.identity(), None, None, None, &stub, || async {
                Err(AppError::message("Outdated Figma context"))
            })
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "Outdated Figma context");
        assert_eq!(stub.calls().await, ["current"]);
    }

    #[tokio::test]
    async fn context_is_validated_again_between_stop_and_start() {
        let old = state(Some(100));
        let stub = StubTracker::new(old.clone(), state(None));
        let checks = AtomicUsize::new(0);
        let validate = || {
            let check = checks.fetch_add(1, Ordering::SeqCst);
            async move { if check == 1 { Err(AppError::message("The meeting ended.")) } else { Ok(()) } }
        };
        let error =
            tracking::switch_to(Some(42), &old.identity(), None, None, None, &stub, validate)
                .await
                .unwrap_err();
        assert_eq!(error.to_string(), "The meeting ended.");
        assert_eq!(checks.load(Ordering::SeqCst), 2);
        // The stop already happened; the start is never sent.
        assert_eq!(stub.calls().await, ["current", "stop"]);
    }

    #[tokio::test]
    async fn successful_switch_validates_the_context_twice_and_a_no_op_once() {
        let old = state(Some(100));
        let checks = AtomicUsize::new(0);
        let validate = || {
            checks.fetch_add(1, Ordering::SeqCst);
            no_context()
        };
        let stub = StubTracker::new(old.clone(), state(None));
        tracking::switch_to(Some(42), &old.identity(), None, None, None, &stub, &validate)
            .await
            .unwrap();
        assert_eq!(checks.load(Ordering::SeqCst), 2);
        tracking::switch_to(Some(100), &old.identity(), None, None, None, &stub, &validate)
            .await
            .unwrap();
        assert_eq!(checks.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn unknown_or_rejected_remote_state_stops_before_writes() {
        let unknown: TrackingState = serde_json::from_str(r#"{"timestamp":1}"#).unwrap();
        let stub = StubTracker::new(unknown, state(None));
        let error = tracking::switch_to(Some(42), "unknown", None, None, None, &stub, no_context)
            .await
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "7pace returned an unknown tracking state. Refresh before changing your timer."
        );
        let rejected = StateSpec::new(Some(100)).response("Error").build();
        let stub = StubTracker::new(rejected.clone(), state(None));
        let error = tracking::switch_to(
            Some(42),
            &rejected.identity(),
            None,
            None,
            None,
            &stub,
            no_context,
        )
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), "Server validation");
        assert_eq!(stub.calls().await, ["current"]);
    }

    /// Answers `start` with a fixed state, to test what the transaction accepts as confirmation.
    struct FixedStart {
        current: TrackingState,
        stopped: TrackingState,
        started: TrackingState,
        calls: Mutex<Vec<&'static str>>,
    }

    #[async_trait]
    impl TrackingService for FixedStart {
        async fn current(&self) -> Result<TrackingState> {
            self.calls.lock().await.push("current");
            Ok(self.current.clone())
        }

        async fn start(
            &self,
            _ticket_id: Option<i64>,
            _activity_type: Option<&str>,
            _remark: Option<&str>,
        ) -> Result<TrackingState> {
            self.calls.lock().await.push("start");
            Ok(self.started.clone())
        }

        async fn stop(&self) -> Result<TrackingState> {
            self.calls.lock().await.push("stop");
            Ok(self.stopped.clone())
        }
    }

    fn running(ticket: Option<i64>, activity: Option<&str>, remark: Option<&str>) -> TrackingState {
        let mut state = StateSpec::new(ticket).session("started").build();
        let track = state.track.as_mut().unwrap();
        track.tracking_state = WireValue::text("tracking");
        track.activity_type_id = activity.map(str::to_string);
        track.remark = remark.map(str::to_string);
        state
    }

    #[tokio::test]
    async fn start_must_confirm_ticket_activity_and_comment() {
        let requested = "7pace did not confirm the requested timer. Refresh before trying again.";
        let cases = [
            (state(None), requested),
            (running(Some(7), Some("dev"), Some("Work")), requested),
            (running(None, Some("dev"), Some("Work")), requested),
            (
                running(Some(42), Some("test"), Some("Work")),
                "7pace did not confirm the selected activity type. Refresh and check the running timer before trying again.",
            ),
            (
                running(Some(42), Some("dev"), None),
                "7pace did not confirm the tracking comment. Refresh and check the running timer before trying again.",
            ),
        ];
        for (started, message) in cases {
            let service = FixedStart {
                current: state(None),
                stopped: state(None),
                started,
                calls: Mutex::new(Vec::new()),
            };
            let error = tracking::switch_to(
                Some(42),
                "idle",
                Some("dev"),
                Some("Work"),
                None,
                &service,
                no_context,
            )
            .await
            .unwrap_err();
            assert_eq!(error.to_string(), message);
            assert_eq!(*service.calls.lock().await, ["current", "start"]);
        }
        let service = FixedStart {
            current: state(None),
            stopped: state(None),
            started: running(Some(42), Some("dev"), Some("Work")),
            calls: Mutex::new(Vec::new()),
        };
        let started = tracking::switch_to(
            Some(42),
            "idle",
            Some("dev"),
            Some("Work"),
            None,
            &service,
            no_context,
        )
        .await
        .unwrap();
        assert_eq!(started, service.started);
    }

    #[tokio::test]
    async fn stop_leaves_an_idle_timer_alone_and_requires_confirmation() {
        let idle = state(None);
        let stub = StubTracker::new(idle.clone(), idle.clone());
        assert_eq!(tracking::stop("idle", &stub).await.unwrap(), idle);
        assert_eq!(stub.calls().await, ["current"]);

        let old = state(Some(100));
        let stub = StubTracker::new(old.clone(), old.clone());
        let error = tracking::stop(&old.identity(), &stub).await.unwrap_err();
        assert_eq!(error.to_string(), "7pace did not confirm that tracking stopped.");
        assert_eq!(stub.calls().await, ["current", "stop"]);

        let stub = StubTracker::new(old.clone(), idle.clone());
        assert_eq!(tracking::stop(&old.identity(), &stub).await.unwrap(), idle);
        assert_eq!(stub.calls().await, ["current", "stop"]);
    }

    #[tokio::test]
    async fn transactions_accept_trait_objects_and_are_send() {
        fn assert_send<T: Send>(value: T) -> T {
            value
        }
        let old = state(Some(100));
        let stub = StubTracker::new(old.clone(), state(None));
        let service: &dyn TrackingService = &stub;
        let identity = old.identity();
        let switched = assert_send(tracking::switch_to(
            Some(200),
            &identity,
            None,
            None,
            None,
            service,
            no_context,
        ))
        .await
        .unwrap();
        assert!(switched.running());
        // The stub keeps answering the original session to `current`.
        let stopped = assert_send(tracking::stop(&identity, service)).await.unwrap();
        assert!(!stopped.running());
    }
}

/// Swift `ActivityChoiceTests`.
mod activity_choice_tests {
    use att_core::model::{ActivityType, resolve_activity};

    fn activities() -> Vec<ActivityType> {
        vec![
            ActivityType::new("development", "Development"),
            ActivityType::new("testing", "Testing"),
        ]
    }

    #[test]
    fn selection_is_required_when_activity_types_exist() {
        let error = resolve_activity("", &activities()).unwrap_err();
        assert_eq!(error.to_string(), "Choose an activity type before starting the timer.");
    }

    #[test]
    fn stale_activity_is_rejected() {
        assert!(resolve_activity("removed-activity", &activities()).is_err());
    }

    #[test]
    fn explicit_choice_is_preserved() {
        assert_eq!(resolve_activity("testing", &activities()).unwrap().as_deref(), Some("testing"));
    }

    #[test]
    fn workspaces_without_activity_types_use_server_default() {
        assert_eq!(resolve_activity("", &[]).unwrap(), None);
    }
}

/// Swift `DecodingTests`, except `rejectsUnsafeEndpoints` (moved to att-net with `Endpoint`).
mod decoding_tests {
    use att_core::Cal;
    use att_core::model::TrackingState;
    use att_core::time::wire_date;

    use super::support::StateSpec;

    #[test]
    fn errors_in_http200_are_rejected() {
        let error = StateSpec::new(Some(100)).response("Error").build();
        assert_eq!(error.checked().unwrap_err().to_string(), "Server validation");
    }

    #[test]
    fn numeric_enums_and_activity_checks() {
        let decoded: TrackingState = serde_json::from_str(
            r#"{"track":{"trackingState":3,"tfsId":17,"activityCheck":{"isRunning":true}},"trackSettings":{"responseState":0}}"#,
        )
        .unwrap();
        assert!(decoded.clone().checked().unwrap().running());
        assert!(decoded.track.unwrap().needs_activity_check());
    }

    #[test]
    fn missing_state_is_not_treated_as_idle() {
        let decoded: TrackingState = serde_json::from_str(r#"{"timestamp":1}"#).unwrap();
        assert!(decoded.checked().is_err());
    }

    #[test]
    fn date_formats() {
        let cal = Cal::brussels();
        assert!(wire_date::parse("2026-09-29T08:00:00.1234567Z", None).is_some());
        assert_eq!(
            wire_date::parse("2026-09-29T10:00:00+02:00", None),
            wire_date::parse("2026-09-29T08:00:00Z", None)
        );
        assert!(wire_date::parse("2026-09-29T10:00:00", Some(cal.tz())).is_some());
        assert_eq!(wire_date::parse("not a date", None), None);
    }
}
