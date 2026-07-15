fn main() {
    if std::env::args().any(|argument| argument == "--smoke-test") {
        triforce_desktop_lib::smoke_test();
        return;
    }
    triforce_desktop_lib::run();
}
